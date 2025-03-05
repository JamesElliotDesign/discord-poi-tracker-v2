const express = require("express");
const crypto = require("crypto");
const stringSimilarity = require("string-similarity");
const { sendServerMessage } = require("./services/cftoolsService");

require("dotenv").config();

const PORT = process.env.PORT || 8080;
const CF_WEBHOOK_SECRET = process.env.CF_WEBHOOK_SECRET;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const CLAIMS = {}; // Stores active POI claims
const CLAIM_TIMEOUT = 60 * 60 * 1000; // 60 minutes

// 🟢 Command Regex
const CLAIM_REGEX = /\bclaim\s+([A-Za-z0-9_ -]+)\b/i;
const UNCLAIM_REGEX = /\bunclaim\s+([A-Za-z0-9_ -]+)\b/i;
const CHECK_CLAIMS_REGEX = /\bcheck claims\b/i;
const CHECK_POI_REGEX = /\bcheck\s+([A-Za-z0-9_ -]+)\b/i;

// 🛑 POIs that should NOT be listed in "Check Claims"
const EXCLUDED_POIS = [];

// 🟢 POI LIST with Abbreviations
const POI_MAP = {
    "Sinystok Bunker T5": "Sinystok Bunker",
    "Yephbin Underground Facility T4": "Yephbin",
    "Rostoki Castle T5": "Rostoki",
    "Svetloyarsk Oil Rig T4": "Oil Rig",
    "Elektro Radier Outpost T1": "Elektro",
    "Tracksuit Tower T1": "Tracksuit Tower",
    "Otmel Raider Outpost T1": "Otmel",
    "Svetloyarsk Raider Outpost T1": "Svetloyarsk",
    "Solenchny Raider Outpost T1": "Solenchny",
    "Klyuch Military T2": "Klyuch",
    "Rog Castle Military T2": "Rog",
    "Zub Castle Military T3": "Zub",
    "Kamensk Heli Depot T3": "Kamensk",
    "Tisy Power Plant T4": "Tisy",
    "Krasno Warehouse T2": "Krasno",
    "Balota Warehouse T1": "Balota",
    "Heli Crash (Active Now)": "Heli",
    "Hunter Camp (Active Now)": "Hunter",
    "Airdrop (Active Now)": "Airdrop",
    "Knight (Quest)": "Knight",
    "Banker (Quest)": "Banker"
};

// 🛠 Common Abbreviations
const PARTIAL_POI_MAP = {
    "svet": "Svetloyarsk Raider Outpost T1",
    "tisy": "Tisy Power Plant T4",
    "kamensk": "Kamensk Heli Depot T3",
    "elektro": "Elektro Radier Outpost T1",
    "klyuch": "Klyuch Military T2",
    "rog": "Rog Castle Military T2",
    "zub": "Zub Castle Military T3",
    "oil rig": "Svetloyarsk Oil Rig T4",
    "balota": "Balota Warehouse T1",
    "heli": "Heli Crash (Active Now)",
    "airdrop": "Airdrop (Active Now)",
    "hunter": "Hunter Camp (Active Now)",
    "knight": "Knight (Quest)",
    "banker": "Banker (Quest)"
};

/**
 * Validate webhook signature
 */
function validateSignature(req) {
    const deliveryUUID = req.headers["x-hephaistos-delivery"];
    const receivedSignature = req.headers["x-hephaistos-signature"];

    if (!deliveryUUID || !receivedSignature) return false;

    const localSignature = crypto.createHash("sha256")
        .update(deliveryUUID + CF_WEBHOOK_SECRET)
        .digest("hex");

    return localSignature === receivedSignature;
}

/**
 * Finds the closest matching POI
 */
function findMatchingPOI(input) {
    let normalizedPOI = input.trim().toLowerCase().replace(/\s+/g, " ");

    let correctedPOI = PARTIAL_POI_MAP[normalizedPOI] || POI_MAP[normalizedPOI];

    if (!correctedPOI) {
        let bestMatch = stringSimilarity.findBestMatch(
            normalizedPOI,
            [...Object.keys(POI_MAP), ...Object.values(POI_MAP), ...Object.keys(PARTIAL_POI_MAP)]
        );

        if (bestMatch.bestMatch.rating >= 0.6) {
            correctedPOI = PARTIAL_POI_MAP[bestMatch.bestMatch.target] || POI_MAP[bestMatch.bestMatch.target] || bestMatch.bestMatch.target;
        }
    }

    return correctedPOI || null;
}

/**
 * Automatically release expired POIs after 60 minutes
 */
function releaseExpiredPOIs() {
    const now = Date.now();
    for (let poi in CLAIMS) {
        if (now - CLAIMS[poi].timestamp >= CLAIM_TIMEOUT) {
            delete CLAIMS[poi];
            sendServerMessage(`The claim on ${poi} has expired and is now available.`);
        }
    }
}

// Check expired POIs every minute
setInterval(releaseExpiredPOIs, 60 * 1000);

/**
 * Webhook handler
 */
app.post("/webhook", async (req, res) => {
    try {
        if (!validateSignature(req)) return res.sendStatus(403);

        const eventType = req.headers["x-hephaistos-event"];
        if (eventType !== "user.chat") return res.sendStatus(204);

        const { message, player_name } = req.body;
        const messageContent = message.toLowerCase();
        const playerName = player_name;

        console.log(`[Game Chat] ${playerName}: ${messageContent}`);

        // 🟢 "Check Claims"
        if (CHECK_CLAIMS_REGEX.test(messageContent)) {
            let availablePOIs = Object.keys(POI_MAP).filter(poi => !CLAIMS[poi] && !EXCLUDED_POIS.includes(poi));

            if (availablePOIs.length === 0) {
                await sendServerMessage("All POIs are currently claimed.");
            } else {
                await sendServerMessage(`Available POIs: ${availablePOIs.map(poi => POI_MAP[poi]).join(", ")}`);
            }
            return res.sendStatus(204);
        }

        // 🟢 "Check POI"
        const checkMatch = messageContent.match(CHECK_POI_REGEX);
        if (checkMatch) {
            let correctedPOI = findMatchingPOI(checkMatch[1]);

            if (!correctedPOI) {
                await sendServerMessage(`Unknown POI: ${checkMatch[1]}. Try 'check claims' to see available POIs.`);
                return res.sendStatus(204);
            }

            await sendServerMessage(
                CLAIMS[correctedPOI] 
                    ? `${correctedPOI} is claimed by ${CLAIMS[correctedPOI].player}.` 
                    : `${correctedPOI} is available to claim!`
            );
            return res.sendStatus(204);
            
        }

       // 🟢 "Claim POI"
        const claimMatch = messageContent.match(CLAIM_REGEX);
        if (claimMatch) {
            let correctedPOI = findMatchingPOI(claimMatch[1]);

            if (!correctedPOI) {
                await sendServerMessage(`Invalid POI: ${claimMatch[1]}. Try 'check claims' to see available POIs.`);
                return res.sendStatus(204);
            }

            // 🔹 Check if already claimed and show time since claim
            if (CLAIMS[correctedPOI]) {
                let timeSinceClaim = Math.floor((Date.now() - CLAIMS[correctedPOI].timestamp) / 60000); // Convert ms → minutes
                await sendServerMessage(`${correctedPOI} was already claimed by ${CLAIMS[correctedPOI].player} ${timeSinceClaim} minutes ago.`);
                return res.sendStatus(204);
            }

            const { isPlayerNearPOI } = require("./distanceCheck");

            const checkResult = await isPlayerNearPOI(playerName, correctedPOI);
            if (!checkResult.success) {
                await sendServerMessage(checkResult.message);
                return res.sendStatus(204);
            }

            // ✅ Claim the POI
            CLAIMS[correctedPOI] = { player: playerName, timestamp: Date.now() };
            await sendServerMessage(`${playerName} claimed ${correctedPOI}.`);
            
        }

       // 🟢 "Unclaim POI"
       const unclaimMatch = messageContent.match(UNCLAIM_REGEX);
       if (unclaimMatch) {
           let correctedPOI = findMatchingPOI(unclaimMatch[1]);

           if (!correctedPOI || !CLAIMS[correctedPOI]) {
            await sendServerMessage(correctedPOI 
                ? `${correctedPOI} is not currently claimed.` 
                : `Invalid POI: ${unclaimMatch[1]}. Try 'check claims' to see available POIs.`
            );            
               return res.sendStatus(204);
           }

           if (CLAIMS[correctedPOI].player !== playerName) {
               await sendServerMessage(`You cannot unclaim ${correctedPOI}. It was claimed by ${CLAIMS[correctedPOI].player}.`);
               return res.sendStatus(204);
           }

           delete CLAIMS[correctedPOI];
           await sendServerMessage(`${playerName} unclaimed ${correctedPOI}.`);
           return res.sendStatus(204);
       }

       res.sendStatus(204);
   } catch (err) {
       console.error("❌ Webhook Error:", err);
       res.sendStatus(500);
   }
});

app.listen(PORT, () => console.log(`🚀 Webhook Server listening on port ${PORT}`));