const axios = require("axios");
require("dotenv").config();

const API_BASE_URL = "https://data.cftools.cloud/v1";
const APPLICATION_ID = process.env.CFTOOLS_APPLICATION_ID;
const APPLICATION_SECRET = process.env.CFTOOLS_APPLICATION_SECRET;
const SERVER_API_ID = process.env.CFTOOLS_SERVER_API_ID; // Found in CFTools Dashboard

let authToken = null;
let tokenExpiration = 0;

/**
 * Authenticate & Get Token
 */
async function authenticate() {
    try {
        const response = await axios.post(`${API_BASE_URL}/auth/register`, {
            application_id: APPLICATION_ID,
            secret: APPLICATION_SECRET,
        }, {
            headers: { "User-Agent": APPLICATION_ID }, // Required by CF Tools
        });

        authToken = response.data.token;
        tokenExpiration = Date.now() + 24 * 60 * 60 * 1000; // Token valid for 24 hours

        console.log("✅ Successfully authenticated with CFTools API");
    } catch (error) {
        console.error("❌ CFTools Authentication Failed:", error.response?.data || error.message);
        throw new Error("Failed to authenticate with CFTools API");
    }
}

/**
 * Get Server Info
 */
async function getServerInfo() {
    try {
        if (!authToken || Date.now() >= tokenExpiration) await authenticate();

        const response = await axios.get(`${API_BASE_URL}/server/${SERVER_API_ID}/info`, {
            headers: {
                "Authorization": `Bearer ${authToken}`,
                "User-Agent": APPLICATION_ID,
            },
        });

        console.log("🔹 Full API Response:", response.data); // Log full response

        return response.data;
    } catch (error) {
        console.error("❌ Failed to fetch server info:", error.response?.data || error.message);
        throw new Error("Error fetching server info");
    }
}

/**
 * Send a Message to In-Game Chat
 */
async function sendServerMessage(content) {
    try {
        if (!authToken || Date.now() >= tokenExpiration) await authenticate();

        const response = await axios.post(
            `${API_BASE_URL}/server/${SERVER_API_ID}/message-server`,
            { content },
            {
                headers: {
                    "Authorization": `Bearer ${authToken}`,
                    "User-Agent": APPLICATION_ID,
                },
            }
        );

        if (response.status === 204) {
            console.log(`✅ Sent message to in-game chat: "${content}"`);
        } else {
            console.log(`⚠️ Unexpected Response from CFTools API: ${response.status}`);
        }
    } catch (error) {
        console.error("❌ Failed to send in-game message:", error.response?.data || error.message);
    }
}

module.exports = { getServerInfo, sendServerMessage };
