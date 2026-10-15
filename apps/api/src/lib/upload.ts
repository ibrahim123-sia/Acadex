// Multipart uploads (one file in the "file" field, kept in memory; storeUpload checks it).
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { HttpError, badRequest } from './errors';

/** Parse one multipart file of at most maxMb; multer's own errors become proper HTTP errors. */
export function oneFile(maxMb = 10) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 10 } });
  return (req: Request, res: Response, next: NextFunction) =>
    upload.single('file')(req, res, (err?: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `The file is too large (maximum ${maxMb} MB)`, undefined, 'FILE_TOO_LARGE'));
      next(err instanceof multer.MulterError ? badRequest(err.message) : err);
    });
}

export function requireFile(req: Request) {
  if (!req.file) throw badRequest('Attach a file in the "file" field');
  return req.file;
}
