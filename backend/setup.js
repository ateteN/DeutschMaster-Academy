/**
 * ================================================================
 * DeutschMaster — MTN MoMo Sandbox Setup Script
 * Run this ONCE to generate your API User ID and API Key
 * 
 * Usage:
 *   1. Paste your Primary Key below
 *   2. Run: node setup.js
 *   3. Copy the output into your .env file
 * ================================================================
 */

const https = require("https");
const { randomUUID } = require("crypto");

// ── PASTE YOUR PRIMARY KEY HERE ──────────────────────────────────
const PRIMARY_KEY = "54b72577d7bb4a15bf832c29181aa912";
// ─────────────────────────────────────────────────────────────────

const USER_ID = randomUUID(); // generates a random UUID for you

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function setup() {
  console.log("\n🚀 DeutschMaster — MTN MoMo Sandbox Setup\n");
  console.log("Generated User ID:", USER_ID);

  // ── STEP 1: Create API User ──────────────────────────────────
  console.log("\n⏳ Step 1: Creating API User...");
  const step1 = await makeRequest(
    {
      hostname: "sandbox.momodeveloper.mtn.com",
      path: "/v1_0/apiuser",
      method: "POST",
      headers: {
        "X-Reference-Id": USER_ID,
        "Ocp-Apim-Subscription-Key": PRIMARY_KEY,
        "Content-Type": "application/json",
      },
    },
    { providerCallbackHost: "https://deutschmaster.com" }
  );

  if (step1.status === 201) {
    console.log("✅ API User created successfully.");
  } else {
    console.error("❌ Failed to create API User:", step1.status, step1.body);
    console.error("👉 Check your PRIMARY_KEY is correct and try again.");
    process.exit(1);
  }

  // ── STEP 2: Generate API Key ─────────────────────────────────
  console.log("\n⏳ Step 2: Generating API Key...");
  const step2 = await makeRequest({
    hostname: "sandbox.momodeveloper.mtn.com",
    path: `/v1_0/apiuser/${USER_ID}/apikey`,
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": PRIMARY_KEY,
    },
  });

  if (step2.status === 201) {
    const API_KEY = step2.body.apiKey;
    console.log("✅ API Key generated successfully.\n");

    console.log("═══════════════════════════════════════════════════");
    console.log("  Copy these into your .env file:");
    console.log("═══════════════════════════════════════════════════");
    console.log(`MOMO_PRIMARY_KEY=${PRIMARY_KEY}`);
    console.log(`MOMO_USER_ID=${USER_ID}`);
    console.log(`MOMO_API_KEY=${API_KEY}`);
    console.log(`MOMO_ENV=sandbox`);
    console.log("═══════════════════════════════════════════════════\n");
  } else {
    console.error("❌ Failed to generate API Key:", step2.status, step2.body);
    process.exit(1);
  }
}

setup().catch(console.error);