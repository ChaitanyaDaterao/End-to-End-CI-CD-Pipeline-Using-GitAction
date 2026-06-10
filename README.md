# BMS – Building Material Management System

## Tech Stack
- **Frontend**: React 18, React Router v6, Axios, react-hot-toast
- **Backend**: Node.js, Express, JWT Auth
- **Database**: MongoDB (local or Atlas)

---

## Project Structure

```
bms/
├── server/          ← Node + Express backend
│   ├── config/db.js
│   ├── middleware/auth.js
│   ├── models/Admin.js
│   ├── routes/auth.js
│   ├── .env
│   └── index.js
└── client/          ← React frontend
    └── src/
        ├── context/AuthContext.js
        ├── components/ProtectedRoute.js
        ├── pages/Login.js + Login.css
        ├── pages/Dashboard.js + Dashboard.css
        ├── App.js
        └── index.js
```

---

## Setup & Run

### 1. Make sure MongoDB is running
```bash
mongod
```

### 2. Start the backend
```bash
cd server
npm install
npm run dev
```
Server runs on: http://localhost:5000

### 3. Create admin account (run once)
Open browser or Postman and hit:
```
POST http://localhost:5000/api/auth/seed
```
This creates: **username: admin / password: admin123**

### 4. Start the frontend
```bash
cd client
npm install
npm start
```
App runs on: http://localhost:3000

---

## Login
- URL: http://localhost:3000/login
- Username: `admin`
- Password: `admin123`

---

## Modules (being built module by module)
- [x] Module 1: Project Setup + Admin Login
- [ ] Module 2: Material Management
- [ ] Module 3: Vehicle Management
- [ ] Module 4: Staff (Driver & Conductor)
- [ ] Module 5: Billing (Trip + Quantity)
- [ ] Module 6: Pokland Management
- [ ] Module 7: P&L Reports + Weekly Billing
