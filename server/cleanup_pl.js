const mongoose = require('mongoose');

// Update this connection string if your DB name is different
const mongoURI = 'mongodb://127.0.0.1:27017/your_database_name';

async function cleanupOrphanedData() {
    try {
        await mongoose.connect(mongoURI);
        console.log("Connected to Database...");

        // 1. Delete Vehicle Expenses for inactive vehicles
        const expenseRes = await mongoose.connection.collection('vehicleexpenses').deleteMany({
            $or: [
                { activeOwn: false },
                { activeRental: false }
            ]
        });
        console.log(`🗑️ Deleted ${expenseRes.deletedCount} Vehicle Expenses.`);

        // 2. Delete Rental Payments where owner is undefined/inactive
        const rentalRes = await mongoose.connection.collection('rentalpayments').deleteMany({
            $or: [
                { ownerName: { $exists: false } },
                { ownerName: null },
                { ownerName: "undefined" }
            ]
        });
        console.log(`🗑️ Deleted ${rentalRes.deletedCount} Rental Payments.`);

        // 3. Delete Pokland Payments for inactive poklands
        const poklandPayRes = await mongoose.connection.collection('poklandpayments').deleteMany({
            poklandActive: false
        });
        console.log(`🗑️ Deleted ${poklandPayRes.deletedCount} Pokland Payments.`);

        // 4. Delete Pokland Trip Entries for inactive poklands
        const poklandEntryRes = await mongoose.connection.collection('poklandentries').deleteMany({
            ownActive: false
        });
        console.log(`🗑️ Deleted ${poklandEntryRes.deletedCount} Pokland Entries.`);

        console.log("\n✅ Cleanup Complete! Your P&L should now be clear.");
        process.exit();
    } catch (err) {
        console.error("❌ Error during cleanup:", err);
        process.exit(1);
    }
}

cleanupOrphanedData();