import multer from "multer";

export function uploadCsvMiddleware() {
  const maxMb = Number(process.env.MAX_UPLOAD_MB || 30);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const okExt = (file.originalname || "").toLowerCase().endsWith(".csv");
      if (!okExt) return cb(new Error("Solo se permite archivo .csv"));
      cb(null, true);
    },
  });

  return upload.single("file");
}
