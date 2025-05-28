const express = require("express");
const cors = require("cors");
const fs = require("fs");
const csv = require("csv-parser");
const { createObjectCsvWriter } = require("csv-writer");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 3000;
const CSV_FILE = "data.csv";
const HEADERS = ["ID", "Date", "Type", "Amount (₹)", "Comment"];

app.use(bodyParser.json());

// Allow CORS from any origin (for development)
app.use(cors());

// OR allow only your frontend domain:
app.use(
    cors({
        origin: '*',
    }),
);

// Read all records from the CSV file
function readCSV() {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(CSV_FILE)
            .pipe(csv())
            .on("data", (data) => results.push(data))
            .on("end", () => resolve(results))
            .on("error", reject);
    });
}

// Write all records to the CSV file
function writeCSV(data) {
    const csvWriter = createObjectCsvWriter({
        path: CSV_FILE,
        header: HEADERS.map((h) => ({ id: h, title: h })),
    });
    return csvWriter.writeRecords(data);
}

// GET all records
app.get("/api/expenses", async (req, res) => {
    try {
        const data = await readCSV();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: "Failed to read data" });
    }
});

// POST create a new record
app.post("/api/expenses", async (req, res) => {
    const { Date, Type, "Amount (₹)": Amount, Comment } = req.body;
    if (!Date || !Type || !Amount) {
        return res
            .status(400)
            .json({ error: "Date, Type, and Amount (₹) are required" });
    }

    try {
        const newEntry = {
            ID: uuidv4(),
            Date,
            Type,
            "Amount (₹)": Amount,
            Comment: Comment || "",
        };

        const data = await readCSV();
        data.push(newEntry);
        await writeCSV(data);
        res.status(201).json({
            message: "Expense added successfully",
            entry: newEntry,
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to write data" });
    }
});

// PUT update a record by ID
app.put("/api/expenses/:id", async (req, res) => {
    const id = req.params.id;
    const { Date, Type, "Amount (₹)": Amount, Comment } = req.body;

    try {
        const data = await readCSV();
        const index = data.findIndex((item) => item.ID === id);
        if (index === -1) {
            return res.status(404).json({ error: "Record not found" });
        }

        data[index] = {
            ...data[index], // retain original fields
            Date: Date || data[index].Date,
            Type: Type || data[index].Type,
            "Amount (₹)": Amount || data[index]["Amount (₹)"],
            Comment: Comment || data[index].Comment,
        };

        await writeCSV(data);
        res.json({ message: "Record updated", updatedRecord: data[index] });
    } catch (err) {
        res.status(500).json({ error: "Failed to update data" });
    }
});

// DELETE a record by ID
app.delete("/api/expenses/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const data = await readCSV();
        const index = data.findIndex((item) => item.ID === id);
        if (index === -1) {
            return res.status(404).json({ error: "Record not found" });
        }

        const removed = data.splice(index, 1);
        await writeCSV(data);
        res.json({ message: "Record deleted", deleted: removed[0] });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete data" });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
