const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const fs = require('node:fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const csv = require('fast-csv');
const pdf = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;
const CSV_FILE_PATH = path.join(__dirname, 'expenses.csv');
const CSV_HEADERS = ['id', 'date', 'type', 'amount', 'comment'];

// Middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing

app.use(
    cors({
        origin: '*',
    }),
);
app.use(express.json()); // To parse JSON request bodies
app.use(fileUpload());

// Function to extract bank statement data
async function extractBankStatementData(pdfPath) {
    const dataBuffer = fs.readFileSync(pdfPath);

    try {
        const data = await pdf(dataBuffer);
        const text = data.text.trim();
        const lines = text.split('\n');

        const transactions = [];
        let currentTransaction = { Date: '', Description: '', Amount: '', Type: '' };
        let inTransaction = false;

        lines.forEach(line => {
            const normalizedLine = line.replace(/\s+/g, ' ').trim();
            const datePattern = /^\d{2}-\d{2}-\d{4}/;
            const amountPattern = /^\d+(\.\d{2})?$/;
            const typePattern = /^(DR|CR)$/;

            if (normalizedLine.match(datePattern)) {
                if (inTransaction && currentTransaction.Type === "DR") {
                    transactions.push(currentTransaction);
                }
                currentTransaction = {
                    Date: normalizedLine.slice(0, 10),
                    Description: normalizedLine.slice(10).trim(),
                    Amount: '',
                    Type: ''
                };
                inTransaction = true;
            } else if (amountPattern.test(normalizedLine)) {
                currentTransaction.Amount = normalizedLine;
            } else if (typePattern.test(normalizedLine)) {
                currentTransaction.Type = normalizedLine;
                if (currentTransaction.Type === "DR") {
                    transactions.push(currentTransaction);
                }
                currentTransaction = { Date: '', Description: '', Amount: '', Type: '' };
                inTransaction = false;
            } else {
                if (inTransaction) {
                    currentTransaction.Description += ' ' + normalizedLine;
                }
            }
        });

        if (inTransaction && currentTransaction.Type === "DR") {
            transactions.push(currentTransaction);
        }

        return transactions;
    } catch (error) {
        console.error('Error reading PDF:', error);
        throw error;
    }
}

// Upload endpoint
app.post('/api/upload', async (req, res) => {
    
    if (!req.files || !req.files.pdf) {
        return res.status(400).send('No PDF file uploaded.');
    }

    const pdfFile = req.files.pdf;
    const uploadPath = path.join(__dirname, pdfFile.name);

    try {
        await pdfFile.mv(uploadPath);
        const result = await extractBankStatementData(uploadPath);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error processing PDF.');
    }
});


// --- Helper Functions for CSV Operations ---

/**
 * Reads all expenses from the CSV file.
 * @returns {Promise<Array<Object>>} A promise that resolves with an array of expense objects.
 */
function readExpensesFromCSV() {
    return new Promise((resolve, reject) => {
        const expenses = [];
        if (!fs.existsSync(CSV_FILE_PATH)) {
            // If file doesn't exist, create it with headers
            fs.writeFileSync(CSV_FILE_PATH, CSV_HEADERS.join(',') + '\n', 'utf8');
            resolve([]); // Return empty array as there are no expenses yet
            return;
        }

        fs.createReadStream(CSV_FILE_PATH)
            .pipe(csv.parse({ headers: true, trim: true, skipLines: 0 })) // headers: true uses the first row as keys
            .on('error', error => reject(error))
            .on('data', row => {
                // Ensure amount is a number
                row.amount = parseFloat(row.amount);
                // Ensure comment is a string, even if empty or null from CSV
                row.comment = row.comment || '';
                expenses.push(row);
            })
            .on('end', (rowCount) => {
                console.log(`Parsed ${rowCount} rows`);
                resolve(expenses);
            });
    });
}

/**
 * Writes an array of expense objects to the CSV file.
 * @param {Array<Object>} expenses The array of expense objects to write.
 * @returns {Promise<void>} A promise that resolves when writing is complete.
 */
function writeExpensesToCSV(expenses) {
    return new Promise((resolve, reject) => {
        const writableStream = fs.createWriteStream(CSV_FILE_PATH);
        const csvStream = csv.format({ headers: CSV_HEADERS, writeHeaders: true });

        writableStream.on('finish', resolve);
        writableStream.on('error', reject);

        csvStream.pipe(writableStream);
        expenses.forEach(expense => csvStream.write(expense));
        csvStream.end();
    });
}

// --- API Endpoints ---

// GET /api/expenses - Retrieve all expenses
app.get('/api/expenses', async (req, res) => {
    try {
        const expenses = await readExpensesFromCSV();
        res.json(expenses);
    } catch (error) {
        console.error('Error reading expenses:', error);
        res.status(500).json({ message: 'Failed to retrieve expenses', error: error.message });
    }
});

// POST /api/expenses - Add a new expense
app.post('/api/expenses', async (req, res) => {
    try {
        const { date, type, amount, comment } = req.body;

        // Basic validation
        if (!date || !type || amount === undefined || amount === null) {
            return res.status(400).json({ message: 'Missing required fields: date, type, amount' });
        }
        if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ message: 'Amount must be a positive number' });
        }

        const newExpense = {
            id: uuidv4(), // Generate a unique ID
            date,
            type,
            amount: parseFloat(amount),
            comment: comment || '' // Ensure comment is a string
        };

        const expenses = await readExpensesFromCSV();
        expenses.push(newExpense);
        await writeExpensesToCSV(expenses);

        res.status(201).json(newExpense); // Return the newly created expense
    } catch (error) {
        console.error('Error adding expense:', error);
        res.status(500).json({ message: 'Failed to add expense', error: error.message });
    }
});

// DELETE /api/expenses/:id - Delete an expense
app.delete('/api/expenses/:id', async (req, res) => {
    try {
        const expenseIdToDelete = req.params.id;
        let expenses = await readExpensesFromCSV();
        const initialLength = expenses.length;

        expenses = expenses.filter(expense => expense.id !== expenseIdToDelete);

        if (expenses.length === initialLength) {
            return res.status(404).json({ message: 'Expense not found' });
        }

        await writeExpensesToCSV(expenses);
        res.status(200).json({ message: 'Expense deleted successfully' }); // Or 204 No Content
    } catch (error) {
        console.error('Error deleting expense:', error);
        res.status(500).json({ message: 'Failed to delete expense', error: error.message });
    }
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Ensure CSV file exists with headers if it's new
    if (!fs.existsSync(CSV_FILE_PATH)) {
        console.log(`CSV file not found. Creating ${CSV_FILE_PATH} with headers.`);
        try {
            fs.writeFileSync(CSV_FILE_PATH, CSV_HEADERS.join(',') + '\n', 'utf8');
            console.log('CSV file created successfully.');
        } catch (err) {
            console.error('Failed to create CSV file:', err);
        }
    } else {
        // Optional: Check if headers are present, if not, add them.
        // This is a bit more involved, as you'd need to read the first line.
        // For simplicity, we assume if the file exists, it's correctly formatted or will be.
        // The readExpensesFromCSV will create it if it's missing anyway.
        console.log(`Using existing CSV file: ${CSV_FILE_PATH}`);
    }
});
