const express = require('express');
const crypto = require('crypto'); // ✅ Required for signature verification
const fs = require('fs');
const stringSimilarity = require('string-similarity');
const { getServerInfo, sendServerMessage, registerWebhook } = require('./services/cftoolsService');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.CFTOOLS_WEBHOOK_SECRET; // ✅ New Secret for verification

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; }})); // ✅ Store raw request body for verification

// Store webhook logs for debugging
const LOG_FILE = 'webhook_logs.json';
const logWebhookData = (data) => {
    fs.appendFile(LOG_FILE, JSON.stringify(data, null, 2) + "\n", (err) => {
        if (err) console.error("Error logging webhook data:", err);
    });
};

const CLAIM_REGEX = /\bCLAIM\s+([A-Za-z0-9_ -]+)\b/i;
const POI_LIST = [
    "Sinystok Bunker T5", "Yephbin Underground Facility T4", "Rostoki Castle T5", "Svetloyarsk Oil Rig T4", 
    "Elektro Radier Outpost T1", "Tracksuit Tower T1", "Otmel Raider Outpost T1", "Svetloyarsk Raider Outpost T1", 
    "Solenchny Raider Outpost T1", "Klyuch Military T2", "Rog Castle Military T2", "Zub Castle Military T3", 
    "Kamensk Heli Depot T3", "Tisy Power Plant T4", "Krasno Warehouse T2", "Balota Warehouse T1"
];

const CLAIMS = {};

// ✅ Function to verify webhook request signature
const verifySignature = (req) => {
    const receivedSignature = req.headers['x-hephaistos-signature']; // ✅ CORRECT HEADER
    const deliveryId = req.headers['x-hephaistos-delivery']; // ✅ REQUIRED FOR SIGNING

    if (!receivedSignature || !WEBHOOK_SECRET || !deliveryId) {
        console.error("❌ Missing required headers for signature verification.");
        return false;
    }

    // Generate expected signature
    const expectedSignature = crypto.createHash('sha256')
        .update(deliveryId + WEBHOOK_SECRET)
        .digest('hex');

    if (expectedSignature !== receivedSignature) {
        console.error(`❌ Webhook Signature Mismatch! Expected: ${expectedSignature}, Received: ${receivedSignature}`);
        return false;
    }

    console.log("✅ Webhook Signature Verified!");
    return true;
};

// ✅ Initialize and Fetch Server Info on Startup
(async () => {
    try {
        const serverInfo = await getServerInfo();
        console.log("✅ Connected to CFTools API");
        console.log("🔹 Server Name:", serverInfo.server._object.nickname);
        console.log("🔹 Server ID:", serverInfo.server.gameserver.gameserver_id);
        console.log("🔹 Connection Protocol:", serverInfo.server.connection.protcol_used);
        console.log("🔹 Worker State:", serverInfo.server.worker.state);
        console.log("✅ Webhook should already be manually registered in CFTools Cloud.");
        console.log("🔗 Registering CF Tools Webhook...");
        await registerWebhook(process.env.CFTOOLS_WEBHOOK_URL);
    } catch (error) {
        console.error("❌ Error during API communication:", error.message);
    }
})();

// ✅ Webhook Route to receive CF Tools Chat Data
app.post('/webhook', async (req, res) => {
    try {
        if (!verifySignature(req)) {
            console.error("❌ Webhook signature verification failed!");
            return res.status(403).send('Forbidden');
        }

        const data = req.body;
        logWebhookData(data);

        if (!data || !data.message || !data.username) {
            return res.status(400).send('Invalid Data');
        }

        const playerName = data.username;
        const messageContent = data.message;

        console.log(`[Game Chat] ${playerName}: ${messageContent}`);

        const match = messageContent.match(CLAIM_REGEX);
        if (match) {
            let detectedPOI = match[1].trim().toLowerCase();

            // Find the closest match in POI list
            let bestMatch = stringSimilarity.findBestMatch(detectedPOI, POI_LIST);
            let correctedPOI = bestMatch.bestMatch.rating > 0.5 ? POI_LIST[bestMatch.bestMatchIndex] : null;

            if (correctedPOI) {
                if (CLAIMS[correctedPOI]) {
                    const timeElapsed = Math.floor((Date.now() - CLAIMS[correctedPOI].timestamp) / 60000);
                    const claimer = CLAIMS[correctedPOI].player;
                    console.log(`🚫 POI Already Claimed: ${claimer} already claimed ${correctedPOI} ${timeElapsed} minutes ago.`);
                    await sendServerMessage(`${claimer} already claimed ${correctedPOI} ${timeElapsed} minutes ago.`);
                } else {
                    CLAIMS[correctedPOI] = { player: playerName, timestamp: Date.now() };
                    console.log(`✅ Claim Accepted: ${playerName} claimed ${correctedPOI}.`);
                    await sendServerMessage(`${playerName} claimed ${correctedPOI}.`);

                    // Set a 45-minute expiry on the claim
                    setTimeout(() => {
                        delete CLAIMS[correctedPOI];
                        console.log(`🔄 Claim expired: ${correctedPOI} is now available.`);
                    }, 45 * 60 * 1000);
                }
            } else {
                console.log(`❌ Invalid POI Claim: ${playerName} tried to claim '${detectedPOI}', but no match found.`);
            }
        }

        res.status(200).send('Received');
    } catch (error) {
        console.error("❌ Error processing webhook:", error);
        res.status(500).send('Server Error');
    }
});

app.listen(PORT, () => console.log(`🚀 Webhook listening on port ${PORT}`));
