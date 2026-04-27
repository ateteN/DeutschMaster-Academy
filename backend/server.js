require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());
app.use(cors());

const PRIMARY_KEY = process.env.MOMO_PRIMARY_KEY;
const USER_ID = process.env.MOMO_USER_ID;
const API_KEY = process.env.MOMO_API_KEY;
const ENV = process.env.MOMO_ENV || "sandbox";
const BASE_URL = "https://sandbox.momodeveloper.mtn.com";

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

// Sandbox only accepts EUR with small amounts
// Go live → change to RWF with real amounts
const PLANS = {
  monthly:   { amount: "5",  currency: "EUR", label: "Monthly subscription (8,000 RWF)" },
  quarterly: { amount: "12", currency: "EUR", label: "3-month bundle (20,000 RWF)" },
  crash:     { amount: "9",  currency: "EUR", label: "Exam crash course (15,000 RWF)" },
};

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
  const referenceId = uuidv4();

  try {
    const token = await getBearerToken();

    const momoRes = await axios.post(
      `${BASE_URL}/collection/v1_0/requesttopay`,
      {
        amount: selectedPlan.amount,
        currency: selectedPlan.currency,
        externalId: uuidv4(),
        payer: {
          partyIdType: "MSISDN",
          partyId: cleanPhone,
        },
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
    return res.json({ success: true, referenceId, message: "Payment request sent." });

  } catch (err) {
    const errData = err.response?.data;
    const errStatus = err.response?.status;
    console.error(`[PAYMENT ERROR] Status: ${errStatus} | Data:`, JSON.stringify(errData));
    return res.status(500).json({ error: "Failed to send payment request.", detail: errData || err.message, status: errStatus });
  }
});

app.get("/api/pay/status/:referenceId", async (req, res) => {
  const { referenceId } = req.params;
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
    if (status === "SUCCESSFUL") {
      console.log(`[SUCCESS ✅] Phone: ${payer?.partyId} | Amount: ${amount} ${currency}`);
    }
    return res.json({ status, payer, amount, currency });
  } catch (err) {
    console.error("[STATUS ERROR]", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed to check payment status." });
  }
});

app.get("/api/health", (req, res) => {
  return res.json({ status: "✅ DeutschMaster backend running", env: ENV, keys_loaded: !!PRIMARY_KEY && !!USER_ID && !!API_KEY });
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