const functions = require("firebase-functions");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");
const Busboy = require("busboy");
const cors = require("cors")({origin: true});
const {onRequest} = require("firebase-functions/v2/https");

admin.initializeApp();
const db = admin.firestore();

const BATCH_SIZE = 500;

/**
 * Parses a date input into a JavaScript Date object.
 * @param {string | number} dateInput The date string or number.
 * @return {Date} The parsed Date object.
 */
const parseDDMMYYYY = (dateInput) => {
  if (!dateInput) return null;
  const dateString = String(dateInput);
  const parts = dateString.split(/[/.-]/);
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    const fullYear = year < 100 ? 2000 + year : year;
    const d = new Date(Date.UTC(fullYear, month - 1, day));
    return isNaN(d.getTime()) ? null : d;
  }
  if (!isNaN(dateInput)) {
    const d = new Date(Date.UTC(1900, 0, dateInput - 1));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(dateString);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Processes a worksheet stream and saves data to Firestore.
 * @param {ExcelJS.WorksheetReader} worksheetReader The worksheet reader stream.
 * @param {string} uid The user's unique ID.
 * @return {Promise<number>} Resolves with the number of records processed.
 */
async function processWorksheetStream(worksheetReader, uid) {
  let header = [];
  let timeSlots = [];
  let batch = db.batch();
  let batchCounter = 0;
  let validRecords = 0;

  for await (const row of worksheetReader) {
    if (row.number === 1) {
      header = row.values.map((h) => String(h || "").trim());
      timeSlots = Array.from({length: 28}, (_, i) => {
        const hour = Math.floor(i / 2) + 5;
        const minute = i % 2 === 0 ? "00" : "30";
        return `${String(hour).padStart(2, "0")}:${minute}`;
      });
      continue;
    }

    const rowData = row.values;
    if (!rowData || !rowData[1]) continue;

    const date = parseDDMMYYYY(rowData[1]);
    if (!date) continue;

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
    const docRef =
      db.collection("users").doc(uid).collection("dailySales").doc(docId);

    const dayData = {
      id: docId,
      date: date.toISOString(),
      dayOfWeek: date.toLocaleDateString("en-GB", {
        weekday: "long",
        timeZone: "UTC",
      }),
      sales: alignedSales,
      totalSales,
    };

    batch.set(docRef, dayData);
    batchCounter++;
    validRecords++;

    if (batchCounter >= BATCH_SIZE) {
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

exports.processSalesData = onRequest(
    {timeoutSeconds: 540, memory: "1GiB"},
    (req, res) => {
      cors(req, res, async () => {
        if (req.method !== "POST") {
          return res.status(405).send("Method Not Allowed");
        }

        let idToken;
        try {
          if (!req.headers.authorization ||
            !req.headers.authorization.startsWith("Bearer ")) {
            throw new Error("Unauthorized");
          }
          idToken = req.headers.authorization.split("Bearer ")[1];
          req.user = await admin.auth().verifyIdToken(idToken);
        } catch (error) {
          functions.logger.error("Error verifying Firebase ID token:", error);
          return res.status(403).send("Unauthorized");
        }

        const busboyOptions = {headers: req.headers};
        const busboy = new Busboy(busboyOptions);

        busboy.on("file", (fieldname, file, {filename}) => {
          const workbook = new ExcelJS.stream.xlsx.WorkbookReader();
          const isCsv = filename.toLowerCase().endsWith(".csv");

          const streamOptions = {entries: "emit"};
          const stream = isCsv ? file : workbook.read(file, streamOptions);

          stream.on("error", (error) => {
            functions.logger.error("Stream processing error:", error);
            if (!res.headersSent) {
              res.status(500).send({error: "Error reading file stream."});
            }
          });

          stream.on("worksheet", (worksheetReader) => {
            processWorksheetStream(worksheetReader, req.user.uid)
                .then((count) => res.status(200)
                    .send({message: `Success: ${count} records.`}))
                .catch((err) => res.status(500)
                    .send({error: err.message}));
          });

          if (isCsv) {
            const csvWorkbook = new ExcelJS.stream.csv.WorkbookReader();
            const parserOptions = {header: true, delimiter: ","};
            csvWorkbook.read(file, {parserOptions})
                .on("worksheet", (worksheetReader) => {
                  processWorksheetStream(worksheetReader, req.user.uid)
                      .then((count) => res.status(200)
                          .send({message: `Success: ${count} records.`}))
                      .catch((err) => res.status(500)
                          .send({error: err.message}));
                });
          }
        });

        busboy.end(req.rawBody);
      });
    },
);
