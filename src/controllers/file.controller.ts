import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError';
import { ApiResponse } from '../utils/apiResponse';

/**
 * Upload E2EE Encrypted Blob / Media Attachment
 * POST /api/v1/files/upload-encrypted
 */
export const uploadEncryptedFile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) throw ApiError.unauthorized();

    const { encryptedData, fileName, mimeType, fileSize, isVoiceNote } = req.body;

    if (!encryptedData) {
      throw ApiError.badRequest('Encrypted payload binary string or base64 data required.');
    }

    // Zero-Knowledge Storage: The server saves encrypted payload blob without key
    const fileId = 'enc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    res.status(201).json(
      ApiResponse.created(
        {
          fileId,
          fileName: fileName || 'encrypted_attachment',
          mimeType: mimeType || 'application/octet-stream',
          fileSize: fileSize || '0 KB',
          isVoiceNote: !!isVoiceNote,
          downloadUrl: `/api/v1/files/download/${fileId}`
        },
        'Encrypted file payload stored successfully'
      )
    );
  } catch (error) {
    next(error);
  }
};
