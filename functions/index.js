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
 * @return {Date | null} The parsed Date object or null if invalid.
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
  const timeSlots = Array.from({length: 28}, (_, i) => {
    const hour = Math.floor(i / 2) + 5;
    const minute = i % 2 === 0 ? "00" : "30";
    return `${String(hour).padStart(2, "0")}:${minute}`;
  });

  let batch = db.batch();
  let batchCounter = 0;
  let validRecords = 0;
  let isFirstRow = true;

  for await (const row of worksheetReader) {
    if (isFirstRow) {
      header = row.values.map((h) => String(h || "").trim());
      isFirstRow = false;
      continue;
    }

    const rowData = row.values;
    if (!rowData || rowData.length < 2) continue;

    const rowObject = {};
    header.forEach((key, i) => {
      rowObject[key] = rowData[i];
    });

    const date = parseDDMMYYYY(Object.values(rowObject)[0]);
    if (!date) continue;

    const alignedSales = Array(timeSlots.length).fill(0);
    header.slice(1).forEach((slot) => {
      const mainIndex = timeSlots.indexOf(slot);
      if (mainIndex !== -1 && rowObject[slot]) {
        alignedSales[mainIndex] = parseFloat(rowObject[slot]) || 0;
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

        let user;
        try {
          if (!req.headers.authorization ||
            !req.headers.authorization.startsWith("Bearer ")) {
            throw new Error("Unauthorized");
          }
          const idToken = req.headers.authorization.split("Bearer ")[1];
          user = await admin.auth().verifyIdToken(idToken);
        } catch (error) {
          functions.logger.error("Auth error:", error);
          return res.status(403).send("Unauthorized");
        }

        const busboy = new Busboy({headers: req.headers});

        busboy.on("file", (fieldname, file, {filename}) => {
          const isCsv = filename.toLowerCase().endsWith(".csv");

          const processAndRespond = (worksheetReader) => {
            processWorksheetStream(worksheetReader, user.uid)
                .then((count) => {
                  if (!res.headersSent) {
                    const message = `Processed ${count} records.`;
                    res.status(200).send({message});
                  }
                })
                .catch((err) => {
                  functions.logger.error("Processing error:", err);
                  if (!res.headersSent) {
                    res.status(500).send({error: err.message});
                  }
                });
          };

          if (isCsv) {
            const csvReader = new ExcelJS.stream.csv.WorkbookReader();
            csvReader.read(file, {headers: true, delimiter: ","})
                .on("worksheet", processAndRespond)
                .on("error", (err) => {
                  if (!res.headersSent) {
                    res.status(500).send({error: err.message});
                  }
                });
          } else {
            const workbook = new ExcelJS.stream.xlsx.WorkbookReader();
            workbook.read(file, {entries: "emit"})
                .on("worksheet", processAndRespond)
                .on("error", (err) => {
                  if (!res.headersSent) {
                    res.status(500).send({error: err.message});
                  }
                });
          }
        });

        busboy.end(req.rawBody);
      });
    },
);
