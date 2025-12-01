const express = require("express");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const app = express();
const PORT = process.env.PORT || 6000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// WhatsApp Client with session persistence
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "whatsapp-bot",
    dataPath: "./sessions",
  }),
  puppeteer: {
    headless: true,
    executablePath: process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/usr/bin/google-chrome-stable",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  },
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/AmeUr56/whatsapp-web-versions/main/html/2.3000.1017531498-alpha.html",
  },
});

// Bot status
let isReady = false;
let qrCodeData = null;

client.on("qr", (qr) => {
  console.log("QR Code received, please scan with your WhatsApp mobile app:");
  qrcode.generate(qr, { small: true });
  qrCodeData = qr;
});

client.on("loading_screen", (percent, message) => {
  console.log("Loading:", percent, "%", message);
});

client.on("ready", () => {
  console.log("WhatsApp Client is ready!");
  isReady = true;
  qrCodeData = null;
});

client.on("authenticated", () => {
  console.log("WhatsApp Client authenticated successfully");
});

client.on("auth_failure", (msg) => {
  console.error("Authentication failed:", msg);
  isReady = false;
});

client.on("change_state", (state) => {
  console.log("Connection state changed:", state);
});

client.on("disconnected", (reason) => {
  console.log("WhatsApp Client disconnected:", reason);
  isReady = false;
  // Auto-reconnect after disconnection
  console.log("Attempting to reconnect in 5 seconds...");
  setTimeout(() => {
    client.initialize();
  }, 5000);
});

// Initialize WhatsApp Client
client.initialize();

// Helper function to format phone number
function formatPhoneNumber(phoneNumber) {
  // Remove all non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, "");

  // Handle different Rwandan number formats
  if (cleaned.startsWith("250")) {
    // Already has country code (250)
    if (cleaned.length !== 12) {
      throw new Error(
        "Invalid Rwandan phone number. Should be 12 digits with country code (250)"
      );
    }
    return cleaned + "@c.us";
  } else if (cleaned.startsWith("0")) {
    // Local format starting with 0 (e.g., 0788123456)
    if (cleaned.length !== 10) {
      throw new Error(
        "Invalid Rwandan phone number. Local format should be 10 digits starting with 0"
      );
    }
    // Remove the leading 0 and add country code 250
    cleaned = "250" + cleaned.substring(1);
    return cleaned + "@c.us";
  } else if (cleaned.length === 9) {
    // Local format without leading 0 (e.g., 788123456)
    // Add country code 250
    cleaned = "250" + cleaned;
    return cleaned + "@c.us";
  } else {
    throw new Error(
      "Invalid Rwandan phone number format. Use: 250788123456, 0788123456, or 788123456"
    );
  }
}

// API Routes

// Get bot status
app.get("/status", (req, res) => {
  res.json({
    status: isReady ? "ready" : "not_ready",
    qrCode: qrCodeData,
    message: isReady
      ? "Bot is ready to send messages"
      : "Bot is not ready. Please scan QR code if available.",
  });
});

// Get QR Code for authentication
app.get("/qr", (req, res) => {
  if (qrCodeData) {
    res.json({
      qrCode: qrCodeData,
      message: "Please scan this QR code with your WhatsApp mobile app",
    });
  } else if (isReady) {
    res.json({
      message: "Bot is already authenticated and ready",
    });
  } else {
    res.json({
      message: "QR code not available yet. Please wait...",
    });
  }
});

// Send message endpoint
app.post("/send-message", async (req, res) => {
  try {
    if (!isReady) {
      return res.status(503).json({
        success: false,
        error: "WhatsApp client is not ready. Please check /status endpoint.",
      });
    }

    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({
        success: false,
        error: "Phone number and message are required",
      });
    }

    // Format phone number
    const formattedNumber = formatPhoneNumber(phoneNumber);

    // Check if number is registered on WhatsApp
    const isRegistered = await client.isRegisteredUser(formattedNumber);

    if (!isRegistered) {
      return res.status(400).json({
        success: false,
        error: "Phone number is not registered on WhatsApp",
      });
    }

    // Send message
    const sentMessage = await client.sendMessage(formattedNumber, message);

    res.json({
      success: true,
      messageId: sentMessage.id.id,
      to: phoneNumber,
      message: message,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({
      success: false,
      error: "Failed to send message: " + error.message,
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    whatsappReady: isReady,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
  });
});
// Start server
app.listen(PORT, () => {
  console.log(`WhatsApp Bot API server running on port ${PORT}`);
  console.log("Available endpoints:");
  console.log("  GET  /status - Check bot status");
  console.log("  GET  /qr - Get QR code for authentication");
  console.log("  POST /send-message - Send text message");
  console.log("  POST /send-media - Send media message");
  console.log("  GET  /chat-info/:phoneNumber - Get chat information");
  console.log("  POST /logout - Logout and clear session");
  console.log("  GET  /health - Health check");
});

module.exports = app;
