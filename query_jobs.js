const { MongoClient } = require("mongodb");
require("dotenv").config();
const fs = require("fs");

// Parse command line arguments
const args = process.argv.slice(2);
const params = {};
for (let i = 0; i < args.length; i += 2) {
  if (args[i].startsWith("--") && i + 1 < args.length) {
    params[args[i].substring(2)] = args[i + 1];
  }
}

// MongoDB configuration
const MONGODB_URI = params.mongoUri || process.env.MONGODB_URI;
const DB_NAME = params.dbName || process.env.DB_NAME || "naukri_jobs_db";
const COLLECTION_NAME = params.collection || process.env.COLLECTION_NAME || "jobs";

// Query parameters
const query = params.query || "";
const location = params.location || "";
const limit = parseInt(params.limit || "50");
const outputFile = params.output || `./query_results_${new Date().toISOString().split('T')[0]}.json`;

async function queryJobs() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log("Connected to MongoDB");
    
    const db = client.db(DB_NAME);
    const jobsCollection = db.collection(COLLECTION_NAME);
    
    // Build query object
    const queryObj = {};
    if (query) {
      queryObj["Job Title"] = { $regex: query, $options: "i" };
    }
    if (location) {
      queryObj["Location"] = { $regex: location, $options: "i" };
    }
    
    // Execute query
    const jobs = await jobsCollection.find(queryObj).limit(limit).toArray();
    
    console.log(`Found ${jobs.length} jobs matching criteria`);
    
    // Save results to file
    fs.writeFileSync(outputFile, JSON.stringify(jobs, null, 2));
    console.log(`Results saved to ${outputFile}`);
    
    return jobs.length;
  } finally {
    await client.close();
    console.log("MongoDB connection closed");
  }
}

queryJobs()
  .then(jobCount => console.log(`Query completed, found ${jobCount} jobs`))
  .catch(err => console.error("Error executing query:", err));
