const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

const DATA_FOLDER = "C:/Data";
const MONGO_URI = "mongodb://localhost:27017";
const DB_NAME = "bms_debug";

async function importAll() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db(DB_NAME);
    const files = fs.readdirSync(DATA_FOLDER).filter((f) => f.endsWith(".json"));

    if (files.length === 0) {
      console.error("❌ No JSON files found in", DATA_FOLDER);
      process.exit(1);
    }

    console.log(`📂 Found ${files.length} collection files. Starting import...\n`);

    let totalDocs = 0;
    let skipped = 0;

    for (const file of files) {
      const collectionName = path.basename(file, ".json");
      const filePath = path.join(DATA_FOLDER, file);
      const raw = fs.readFileSync(filePath, "utf-8");

      let documents;
      try {
        documents = JSON.parse(raw);
      } catch (err) {
        console.warn(`⚠️  Skipping ${file} — invalid JSON: ${err.message}`);
        skipped++;
        continue;
      }

      // Drop existing collection to avoid duplicates on re-runs
      await db.collection(collectionName).drop().catch(() => {});

      if (!Array.isArray(documents) || documents.length === 0) {
        // Recreate empty collection
        await db.createCollection(collectionName);
        console.log(`  ⬜ ${collectionName}: 0 documents (empty collection preserved)`);
        continue;
      }

      // Restore $oid → ObjectId and $date → Date so types are native
      const restored = documents.map(reviveTypes);

      const result = await db.collection(collectionName).insertMany(restored, { ordered: false });
      totalDocs += result.insertedCount;
      console.log(`  ✅ ${collectionName}: ${result.insertedCount} documents imported`);
    }

    console.log(`\n🎉 Import complete!`);
    console.log(`   Collections processed : ${files.length - skipped}`);
    console.log(`   Total documents imported: ${totalDocs}`);
    if (skipped > 0) console.log(`   Files skipped (bad JSON): ${skipped}`);
    console.log(`\n   Database : ${DB_NAME}`);
    console.log(`   URI      : ${MONGO_URI}`);
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

/**
 * Recursively revive MongoDB Extended JSON types:
 *   { "$oid": "..." }   → ObjectId  (kept as string — driver accepts it)
 *   { "$date": "..." }  → JS Date
 *   { "$numberLong": "..." } → Number
 */
function reviveTypes(value) {
  if (Array.isArray(value)) return value.map(reviveTypes);

  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);

    if (keys.length === 1 && keys[0] === "$oid") {
      // Return as-is; MongoDB Node driver accepts string _id values
      return value["$oid"];
    }
    if (keys.length === 1 && keys[0] === "$date") {
      return new Date(value["$date"]);
    }
    if (keys.length === 1 && keys[0] === "$numberLong") {
      return Number(value["$numberLong"]);
    }

    const out = {};
    for (const k of keys) {
      out[k] = reviveTypes(value[k]);
    }
    return out;
  }

  return value;
}

importAll();
