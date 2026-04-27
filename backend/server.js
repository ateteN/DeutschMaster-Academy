require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());
app.use(cors());

// ── MTN MoMo config ──────────────────────────────────────────────
const PRIMARY_KEY = process.env.MOMO_PRIMARY_KEY;
const USER_ID     = process.env.MOMO_USER_ID;
const API_KEY     = process.env.MOMO_API_KEY;
const ENV         = process.env.MOMO_ENV || "sandbox";
const BASE_URL    = "https://sandbox.momodeveloper.mtn.com";

// ── Supabase admin client ────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getBearerToken() {
  const credentials = Buffer.from(`${USER_ID}:${API_KEY}`).toString("base64");
  const response = await axios.post(
    `${BASE_URL}/collection/token/`,
    {},
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Ocp-Apim-Subscription-Key": PRIMARY_KEY,
      },
    }
  );
  return response.data.access_token;
}

// ── Plans ────────────────────────────────────────────────────────
const PLANS = {
  monthly:   { amount: "5",  currency: "EUR", label: "Monthly subscription (8,000 RWF)",  rwf: 8000,  days: 30 },
  quarterly: { amount: "12", currency: "EUR", label: "3-month bundle (20,000 RWF)",        rwf: 20000, days: 90 },
  crash:     { amount: "9",  currency: "EUR", label: "Exam crash course (15,000 RWF)",     rwf: 15000, days: 30 },
};

// ── Activate subscription + send magic link ──────────────────────
async function activateSubscription(email, plan) {
  const selectedPlan = PLANS[plan] || PLANS.monthly;
  const expiresAt = new Date(Date.now() + selectedPlan.days * 24 * 60 * 60 * 1000).toISOString();

  // Upsert subscription
  const { error: subError } = await supabase.from("subscriptions").upsert(
    { email, plan, status: "active", amount_rwf: selectedPlan.rwf, expires_at: expiresAt },
    { onConflict: "email" }
  );

  if (subError) {
    console.error("[SUPABASE] Subscription error:", subError.message);
    return false;
  }

  console.log(`[SUPABASE ✅] Subscription activated for ${email} | expires: ${expiresAt}`);

  // Send magic link — student clicks once, session saved forever until expiry
  const { error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${process.env.SITE_URL}/dashboard.html` },
  });

  if (linkError) {
    console.error("[SUPABASE] Magic link error:", linkError.message);
  } else {
    console.log(`[MAGIC LINK ✅] Login link sent to ${email}`);
  }

  return true;
}

// ── POST /api/pay/request ────────────────────────────────────────
app.post("/api/pay/request", async (req, res) => {
  const { phone, email, plan } = req.body;

  if (!phone || !email) {
    return res.status(400).json({ error: "Phone number and email are required." });
  }

  let cleanPhone = phone.replace(/[\s\-\+]/g, "");
  if (cleanPhone.length === 10 && cleanPhone.startsWith("0")) {
    cleanPhone = "250" + cleanPhone.slice(1);
  }

  const selectedPlan = PLANS[plan] || PLANS.monthly;
  const referenceId  = uuidv4();

  try {
    const token = await getBearerToken();

    const momoRes = await axios.post(
      `${BASE_URL}/collection/v1_0/requesttopay`,
      {
        amount: selectedPlan.amount,
        currency: selectedPlan.currency,
        externalId: uuidv4(),
        payer: { partyIdType: "MSISDN", partyId: cleanPhone },
        payerMessage: `DeutschMaster — ${selectedPlan.label}`,
        payeeNote: `Subscription for ${email}`,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Reference-Id": referenceId,
          "X-Target-Environment": ENV,
          "Ocp-Apim-Subscription-Key": PRIMARY_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`[PAYMENT REQUESTED ✅] ref: ${referenceId} | phone: ${cleanPhone} | status: ${momoRes.status}`);
    return res.json({ success: true, referenceId, email, plan, message: "Payment request sent." });

  } catch (err) {
    const errData   = err.response?.data;
    const errStatus = err.response?.status;
    console.error(`[PAYMENT ERROR] Status: ${errStatus} | Data:`, JSON.stringify(errData));
    return res.status(500).json({ error: "Failed to send payment request.", detail: errData || err.message, status: errStatus });
  }
});

// ── GET /api/pay/status/:referenceId ────────────────────────────
app.get("/api/pay/status/:referenceId", async (req, res) => {
  const { referenceId } = req.params;
  const { email, plan } = req.query;

  try {
    const token = await getBearerToken();
    const response = await axios.get(
      `${BASE_URL}/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Target-Environment": ENV,
          "Ocp-Apim-Subscription-Key": PRIMARY_KEY,
        },
      }
    );

    const { status, payer, amount, currency } = response.data;
    console.log(`[STATUS] ref: ${referenceId} | status: ${status}`);

    if (status === "SUCCESSFUL" && email) {
      console.log(`[SUCCESS ✅] Phone: ${payer?.partyId} | Amount: ${amount} ${currency}`);
      await activateSubscription(email, plan || "monthly");
    }

    return res.json({ status, payer, amount, currency });

  } catch (err) {
    console.error("[STATUS ERROR]", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to check payment status." });
  }
});

// ── GET /api/health ──────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  return res.json({
    status: "✅ DeutschMaster backend running",
    env: ENV,
    keys_loaded: !!PRIMARY_KEY && !!USER_ID && !!API_KEY,
    supabase_connected: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_KEY,
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   DeutschMaster Payment Server           ║
  ║   http://localhost:${PORT}                  ║
  ║   MTN MoMo Collections API — ${ENV}   ║
  ╚══════════════════════════════════════════╝
  `);
});