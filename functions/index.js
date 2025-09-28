const functions = require("firebase-functions");
const admin = require("firebase-admin");
const ExcelJS = require("exceljs");
const Busboy = require("busboy");
const cors = require("cors")({origin: true});

admin.initializeApp();
const db = admin.firestore();

const BATCH_SIZE = 500; // Firestore batch write limit

/**
 * Parses a date string or Excel date number into a JavaScript Date object.
 * @param {string | number} dateInput The date string or number to parse.
 * @return {Date} The parsed Date object.
 */
const parseDDMMYYYY = (dateInput) => {
  const dateString = String(dateInput);
  const parts = dateString.split(/[/.-]/);
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    const fullYear = year < 100 ? 2000 + year : year;
    return new Date(Date.UTC(fullYear, month - 1, day));
  }
  // Fallback for Excel dates
  if (!isNaN(dateInput)) {
    return new Date(Date.UTC(1900, 0, dateInput - 1));
  }
  return new Date(dateString);
};

exports.processSalesData = functions.runWith({
  timeoutSeconds: 540,
  memory: "1GB",
}).https.onRequest((req, res) => {
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

    const busboy = new Busboy({headers: req.headers});
    let fileStream;

    busboy.on("file", (fieldname, file, filename) => {
      fileStream = file;
      processStream(fileStream, req.user.uid)
          .then((recordCount) => {
            res.status(200).send({
              message: `Successfully processed and saved ${recordCount} records.`,
            });
          })
          .catch((error) => {
            functions.logger.error("Error processing stream:", error);
            res.status(500).send({error: error.message});
          });
    });

    busboy.end(req.rawBody);
  });
});
