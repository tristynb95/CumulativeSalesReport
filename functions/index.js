// functions/index.js

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const xlsx = require("xlsx");
const cors = require("cors")({origin: true});

admin.initializeApp();
const db = admin.firestore();

/**
 * Parses a date string in DD/MM/YYYY format into a JavaScript Date object.
 * @param {string} dateString The date string to parse.
 * @return {Date} The parsed Date object.
 */
const parseDDMMYYYY = (dateString) => {
  const parts = String(dateString).split(/[/.-]/);
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    const fullYear = year < 100 ? 2000 + year : year;
    return new Date(Date.UTC(fullYear, month - 1, day));
  }
  return new Date(dateString);
};

/**
 * Processes an uploaded sales data file (XLSX) via an HTTP request.
 */
exports.processSalesData = functions.https.onRequest((req, res) => {
  cors(req, res, () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }
    if (!req.body.fileContents) {
      return res.status(400).send("Bad Request: Missing file contents.");
    }

    try {
      const {fileContents} = req.body;
      const workbook = xlsx.read(fileContents, {type: "base64"});
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = xlsx.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
      });

      if (json.length < 2) {
        throw new Error("Spreadsheet is empty or invalid.");
      }

      const header = json[0].map((h) => String(h).trim());
      const timeSlots = Array.from({length: 28}, (_, i) => {
        const hour = Math.floor(i / 2) + 5;
        const minute = i % 2 === 0 ? "00" : "30";
        return `${String(hour).padStart(2, "0")}:${minute}`;
      });
      const fileTimeSlots = header.slice(1);

      const batch = db.batch();
      let validRecords = 0;

      json.slice(1).forEach((row) => {
        if (!row[0]) return;
        const date = parseDDMMYYYY(row[0]);
        if (isNaN(date.getTime())) return;

        const alignedSales = Array(timeSlots.length).fill(0);
        fileTimeSlots.forEach((slot, index) => {
          const mainIndex = timeSlots.indexOf(slot);
          if (mainIndex !== -1) {
            alignedSales[mainIndex] = parseFloat(row.slice(1)[index]) || 0;
          }
        });

        const totalSales = alignedSales.reduce((a, b) => a + b, 0);
        if (totalSales === 0) return;

        const docId = date.toISOString().split("T")[0];
        const docRef = db.collection("dailySales").doc(docId);

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
        validRecords++;
      });

      if (validRecords === 0) {
        throw new Error("No valid data rows found in the file.");
      }

      return batch.commit().then(() => {
        const message =
          `Successfully processed and saved ${validRecords} records.`;
        return res.status(200).send({message});
      });
    } catch (error) {
      functions.logger.error("Error processing file:", error);
      return res.status(500).send({error: error.message});
    }
  });
});
