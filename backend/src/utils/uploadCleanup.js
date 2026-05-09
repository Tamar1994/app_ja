const fs = require('fs');
const path = require('path');

const uploadsRoot = path.join(__dirname, '../../uploads');

const toUploadPath = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string' || !fileUrl.startsWith('/uploads/')) return null;
  const relativePath = fileUrl.replace(/^\/uploads\//, '');
  const absolutePath = path.resolve(uploadsRoot, relativePath);
  if (!absolutePath.startsWith(uploadsRoot)) return null;
  return absolutePath;
};

const deleteUploadFile = async (fileUrl) => {
  const absolutePath = toUploadPath(fileUrl);
  if (!absolutePath) return false;
  try {
    await fs.promises.unlink(absolutePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

const deleteUploadFiles = async (fileUrls = []) => {
  const validUrls = fileUrls.filter(Boolean);
  await Promise.all(validUrls.map((fileUrl) => deleteUploadFile(fileUrl)));
};

const getUploadedFilesFromRequest = (req) => {
  const collectedFiles = [];
  if (req.file) collectedFiles.push(req.file);
  if (req.files) {
    if (Array.isArray(req.files)) {
      collectedFiles.push(...req.files);
    } else {
      Object.values(req.files).forEach((entries) => {
        if (Array.isArray(entries)) collectedFiles.push(...entries);
      });
    }
  }
  return collectedFiles;
};

const cleanupRequestUploads = async (req) => {
  const fileUrls = getUploadedFilesFromRequest(req)
    .map((file) => file.path)
    .filter(Boolean)
    .map((filePath) => {
      const normalizedPath = path.resolve(filePath);
      if (!normalizedPath.startsWith(uploadsRoot)) return null;
      return `/uploads/${path.relative(uploadsRoot, normalizedPath).replace(/\\/g, '/')}`;
    })
    .filter(Boolean);

  await deleteUploadFiles(fileUrls);
};

module.exports = {
  cleanupRequestUploads,
  deleteUploadFile,
  deleteUploadFiles,
};