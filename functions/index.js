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
 * Processes an uploaded sales data file for an authenticated user.
 */
exports.processSalesData = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    // --- AUTHENTICATION CHECK ---
    if (!req.headers.authorization ||
        !req.headers.authorization.startsWith("Bearer ")) {
      return res.status(403).send("Unauthorized");
    }

    let idToken;
    try {
      idToken = req.headers.authorization.split("Bearer ")[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
    } catch (error) {
      functions.logger.error("Error verifying Firebase ID token:", error);
      return res.status(403).send("Unauthorized");
    }
    // --- END AUTHENTICATION CHECK ---

    if (!req.body.fileContents || !req.body.fileName) {
      return res.status(400)
          .send("Bad Request: Missing file contents or file name.");
    }

    try {
      const {fileContents, fileName} = req.body;
      const fileBuffer = Buffer.from(fileContents, "base64");

      let workbook;
      if (fileName.toLowerCase().endsWith(".csv")) {
        const csvData = fileBuffer.toString("utf8");
        workbook = xlsx.read(csvData, {type: "string"});
      } else {
        workbook = xlsx.read(fileBuffer, {type: "buffer", cellDates: true});
      }

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = xlsx.utils.sheet_to_json(sheet, {header: 1, raw: false});

      if (json.length < 2) throw new Error("Spreadsheet is empty or invalid.");

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

        // User-specific data path
        const docRef = db.collection("users").doc(req.user.uid)
            .collection("dailySales").doc(docId);

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

      await batch.commit();
      const message =
        `Successfully processed and saved ${validRecords} records.`;
      return res.status(200).send({message});
    } catch (error) {
      functions.logger.error("Error processing file:", error);
      return res.status(500).send({error: error.message});
    }
  });
});