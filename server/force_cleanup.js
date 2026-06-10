const mongoose = require('mongoose');

// 1. CHECK THIS: Ensure this matches your connection string from your server.js
const mongoURI = 'mongodb://127.0.0.1:27017/bms';

async function autoCleanup() {
    try {
        await mongoose.connect(mongoURI);
        const db = mongoose.connection.db;
        console.log(`🚀 Connected to: ${mongoose.connection.name}`);

        // Get all collection names to make sure we aren't missing them
        const collections = await db.listCollections().toArray();
        const names = collections.map(c => c.name);
        console.log("Found collections:", names.join(", "));

        // Define targets based on common pluralization
        const targets = [
            { name: 'vehicleexpenses', query: {} },
            { name: 'poklandpayments', query: {} },
            { name: 'rentalpayments', query: {} },
            { name: 'poklandentries', query: {} },
            { name: 'trips', query: {} } // Adding trips just in case
        ];

        for (const target of targets) {
            if (names.includes(target.name)) {
                const res = await db.collection(target.name).deleteMany(target.query);
                console.log(`🧹 ${target.name}: Deleted ${res.deletedCount} records`);
            } else {
                console.log(`❓ ${target.name} collection not found, skipping...`);
            }
        }

        console.log("\n✅ Done. If counts are still 0, check the 'Found collections' list above.");
        process.exit();
    } catch (err) {
        console.error("❌ Error:", err);
        process.exit(1);
    }
}

autoCleanup();