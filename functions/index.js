const functions = require("firebase-functions");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");
const Busboy = require("busboy");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

const BATCH_SIZE = 500; // Firestore batch write limit

const parseDDMMYYYY = (dateString) => {
    const parts = String(dateString).split(/[/.-]/);
    if (parts.length === 3) {
        const [day, month, year] = parts.map(Number);
        const fullYear = year < 100 ? 2000 + year : year;
        return new Date(Date.UTC(fullYear, month - 1, day));
    }
    // Fallback for Excel dates
    if (!isNaN(dateString)) {
        return new Date(Date.UTC(1900, 0, dateString - 1));
    }
    return new Date(dateString);
};

exports.processSalesData = functions.runWith({
    timeoutSeconds: 540,
    memory: '1GB' // Allocate more memory just in case
}).https.onRequest((req, res) => {
    cors(req, res, async () => {
        if (req.method !== "POST") {
            return res.status(405).send("Method Not Allowed");
        }

        let idToken;
        try {
            if (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer ")) {
                throw new Error("Unauthorized");
            }
            idToken = req.headers.authorization.split("Bearer ")[1];
            req.user = await admin.auth().verifyIdToken(idToken);
        } catch (error) {
            functions.logger.error("Error verifying Firebase ID token:", error);
            return res.status(403).send("Unauthorized");
        }

        const busboy = Busboy({ headers: req.headers });
        let fileStream;

        busboy.on('file', (fieldname, file, filename) => {
            fileStream = file;
            processStream(fileStream, req.user.uid)
                .then(recordCount => {
                    res.status(200).send({ message: `Successfully processed and saved ${recordCount} records.` });
                })
                .catch(error => {
                    functions.logger.error("Error processing stream:", error);
                    res.status(500).send({ error: error.message });
                });
        });

        busboy.end(req.rawBody);
    });
});

async function processStream(fileStream, uid) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookReader();
    const worksheetReader = (await workbook.read(fileStream, { entries: 'emit' })).worksheets[0];

    let header = [];
    let timeSlots = [];
    let batch = db.batch();
    let batchCounter = 0;
    let validRecords = 0;

    for await (const row of worksheetReader) {
        if (row.number === 1) {
            header = row.values.map(h => String(h).trim());
            timeSlots = Array.from({ length: 28 }, (_, i) => {
                const hour = Math.floor(i / 2) + 5;
                const minute = i % 2 === 0 ? "00" : "30";
                return `${String(hour).padStart(2, "0")}:${minute}`;
            });
            continue;
        }

        const rowData = row.values;
        if (!rowData[1]) continue;

        const date = parseDDMMYYYY(rowData[1]);
        if (isNaN(date.getTime())) continue;

        const alignedSales = Array(timeSlots.length).fill(0);
        header.slice(1).forEach((slot, index) => {
            const mainIndex = timeSlots.indexOf(slot);
            if (mainIndex !== -1) {
                alignedSales[mainIndex] = parseFloat(rowData[index + 2]) || 0;
            }
        });

        const totalSales = alignedSales.reduce((a, b) => a + b, 0);
        if (totalSales === 0) continue;

        const docId = date.toISOString().split("T")[0];
        const docRef = db.collection("users").doc(uid).collection("dailySales").doc(docId);
        
        const dayData = {
            id: docId,
            date: date.toISOString(),
            dayOfWeek: date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }),
            sales: alignedSales,
            totalSales,
        };

        batch.set(docRef, dayData);
        batchCounter++;
        validRecords++;

        if (batchCounter === BATCH_SIZE) {
            await batch.commit();
            batch = db.batch();
            batchCounter = 0;
        }
    }

    if (batchCounter > 0) {
        await batch.commit();
    }

    if (validRecords === 0) {
        throw new Error("No valid data rows found in the file.");
    }

    return validRecords;
}