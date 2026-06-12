require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const connectDB = require('./config/db');
const bankAccountRoutes = require('./routes/bankAccount');

const app = express();
connectDB();

app.use(cors());
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use(express.json());

// --- 1. ALL API ROUTES ---
app.use('/api/auth',            require('./routes/auth'));
app.use('/api/materials',       require('./routes/materials'));
app.use('/api/vehicles',        require('./routes/vehicles'));
app.use('/api/vehicle-expenses', require('./routes/vehicleExpenses'));
app.use('/api/rentalbills',     require('./routes/rentalbills'));
app.use('/api/ownvehiclebills', require('./routes/ownvehiclebills'));
app.use('/api/staff',           require('./routes/staff'));
app.use('/api/billing',         require('./routes/billing'));
app.use('/api/pokland',         require('./routes/pokland'));
app.use('/api/khet',            require('./routes/khet'));
app.use('/api/pl',              require('./routes/pl'));
app.use('/api/siteb',           require('./routes/siteb'));
app.use('/api/owner-ledger',    require('./routes/ownerLedger')); // ✅ FIXED
app.use('/api/bank-accounts', bankAccountRoutes);

// --- 2. SERVE STATIC FILES ---
if (require("fs").existsSync(path.join(__dirname, "../client/build"))) app.use(require("express").static(path.join(__dirname, "../client/build")));

// --- 3. CATCH-ALL ROUTE (MUST BE LAST) ---
app.get('*', (req, res) => {
    if (req.originalUrl.startsWith('/api')) {
        return res.status(404).json({ message: 'API route not found' });
    }
    const indexPath = path.join(__dirname, '../client/build', 'index.html');
    if (require('fs').existsSync(indexPath)) return res.sendFile(indexPath);
    res.status(404).json({ message: 'Client not available in this environment' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));