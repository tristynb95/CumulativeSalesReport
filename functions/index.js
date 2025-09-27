const functions = require("firebase-functions");
const admin = require("firebase-admin");
const xlsx = require("xlsx");
const cors = require("cors")({origin: true});

admin.initializeApp();
const db = admin.firestore();

/**
 * Robustly parses a date string into a JavaScript Date object.
 * Handles DD/MM/YYYY, MM/DD/YYYY, and YYYY-MM-DD formats.
 * @param {string | number} dateInput The date string or Excel date number.
 * @return {Date | null} The parsed Date object or null if invalid.
 */
const parseDate = (dateInput) => {
  if (typeof dateInput === 'number') {
    // Handle Excel's date serial number format
    return new Date(Date.UTC(0, 0, dateInput - 1));
  }

  const dateString = String(dateInput).trim();
  let date = new Date(dateString);

  // If the date is invalid, try parsing common formats
  if (isNaN(date.getTime())) {
    const parts = dateString.split(/[/.-]/);
    if (parts.length === 3) {
      const [p1, p2, p3] = parts.map(Number);
      const year = p3 < 100 ? 2000 + p3 : p3;
      // Attempt DD/MM/YYYY
      let tempDate = new Date(Date.UTC(year, p2 - 1, p1));
      if (!isNaN(tempDate.getTime())) {
        return tempDate;
      }
      // Attempt MM/DD/YYYY
      tempDate = new Date(Date.UTC(year, p1 - 1, p2));
      if (!isNaN(tempDate.getTime())) {
        return tempDate;
      }
    }
  }
  
  return isNaN(date.getTime()) ? null : date;
};

exports.processSalesData = functions.runWith({ memory: '1GB' }).https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      functions.logger.warn("Method Not Allowed:", req.method);
      return res.status(405).send({error: "Method Not Allowed"});
    }

    if (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer ")) {
      functions.logger.warn("Unauthorized: Missing or invalid Authorization header.");
      return res.status(403).send({error: "Unauthorized"});
    }

    try {
      const idToken = req.headers.authorization.split("Bearer ")[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
    } catch (error) {
      functions.logger.error("Error verifying Firebase ID token:", error);
      return res.status(403).send({error: "Unauthorized"});
    }

    if (!req.body.fileContents || !req.body.fileName) {
      functions.logger.warn("Bad Request: Missing file contents or file name.");
      return res.status(400).send({error: "Bad Request: Missing file contents or file name."});
    }

    try {
      const {fileContents, fileName} = req.body;
      const fileBuffer = Buffer.from(fileContents, "base64");

      const workbook = xlsx.read(fileBuffer, {type: "buffer", cellDates: true});
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = xlsx.utils.sheet_to_json(sheet, {header: 1, raw: false});

      if (json.length < 2) {
        throw new Error("Spreadsheet is empty or has no data rows.");
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

      for (const row of json.slice(1)) {
        if (!row || !row[0]) continue;
        
        const date = parseDate(row[0]);
        if (!date) {
            functions.logger.warn(`Skipping row with invalid date: ${row[0]}`);
            continue;
        }

        const alignedSales = Array(timeSlots.length).fill(0);
        fileTimeSlots.forEach((slot, index) => {
          const mainIndex = timeSlots.indexOf(slot);
          if (mainIndex !== -1) {
            alignedSales[mainIndex] = parseFloat(row[index + 1]) || 0;
          }
        });

        const totalSales = alignedSales.reduce((a, b) => a + b, 0);
        if (totalSales === 0) continue;

        const docId = date.toISOString().split("T")[0];
        const docRef = db.collection("users").doc(req.user.uid).collection("dailySales").doc(docId);

        const dayData = {
          id: docId,
          date: date.toISOString(),
          dayOfWeek: date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }),
          sales: alignedSales,
          totalSales,
        };

        batch.set(docRef, dayData, { merge: true }); // Use merge to avoid overwriting existing data unintentionally
        validRecords++;
      }

      if (validRecords === 0) {
        throw new Error("No valid data rows found in the file.");
      }

      await batch.commit();

      // Fetch the updated data to return to the client
      const snapshot = await db.collection("users").doc(req.user.uid).collection("dailySales").orderBy("date", "desc").get();
      const processedData = snapshot.docs.map((doc) => doc.data());

      const message = `Successfully processed and saved ${validRecords} records.`;
      functions.logger.info(message, {user: req.user.uid});
      return res.status(200).send({message, processedData});

    } catch (error) {
      functions.logger.error("Error processing file for user:", req.user.uid, error);
      return res.status(500).send({error: error.message || "An internal error occurred."});
    }
  });
});
