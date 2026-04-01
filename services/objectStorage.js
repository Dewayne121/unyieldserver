const os = require("oci-objectstorage");
const fs = require("fs");
const path = require("path");
const { getOCIConfig } = require("../config/oci");
const { AppError } = require("../middleware/errorHandler");

let _objectStorageClient = null;
const localUploadsRoot = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(localUploadsRoot)) {
  fs.mkdirSync(localUploadsRoot, { recursive: true });
}

const sanitizeFileName = (value) => String(value || "video.mp4")
  .replace(/[^\w.\-]/g, "_")
  .replace(/_+/g, "_");

const resolveLocalPathFromObjectName = (objectName) => {
  const normalized = String(objectName || "").replace(/^\/+/, "");
  const safeRelative = normalized.split(/[\\/]+/).filter(Boolean).join(path.sep);
  const fullPath = path.resolve(localUploadsRoot, safeRelative);
  if (!fullPath.startsWith(path.resolve(localUploadsRoot))) {
    throw new Error("Invalid local object path");
  }
  return fullPath;
};

const uploadVideoLocally = (fileBuffer, fileName) => {
  const timestamp = Date.now();
  const randomSuffix = Math.round(Math.random() * 1e9);
  const objectName = `videos/${timestamp}-${randomSuffix}-${sanitizeFileName(path.basename(fileName || "video.mp4"))}`;
  const localPath = resolveLocalPathFromObjectName(objectName);

  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, fileBuffer);

  return {
    objectName,
    publicUrl: `/uploads/${objectName}`,
  };
};

/**
 * Get OCI Object Storage client (lazy-loaded)
 */
function getObjectStorageClient() {
  if (!_objectStorageClient) {
    const { provider } = getOCIConfig();
    _objectStorageClient = new os.ObjectStorageClient({
      authenticationDetailsProvider: provider
    });
  }
  return _objectStorageClient;
}

function getStorageContext() {
  const { namespace, bucketName } = getOCIConfig();
  if (!namespace || !bucketName) {
    throw new Error('Missing required Oracle credentials: namespace or bucketName');
  }
  return { objectStorageClient: getObjectStorageClient(), namespace, bucketName };
}

/**
 * Upload a video file to Oracle Cloud Object Storage
 * @param {Buffer} fileBuffer - The video file buffer
 * @param {string} fileName - The object name (will be prefixed)
 * @param {string} contentType - MIME type of the video
 * @returns {Promise<{objectName: string, publicUrl: string}>}
 */
async function uploadVideo(fileBuffer, fileName, contentType = 'video/mp4') {
  console.log('[OCI SERVICE] uploadVideo called', {
    fileName,
    contentType,
    bufferLength: fileBuffer?.length
  });

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new AppError("Video upload failed: empty file buffer", 400);
  }

  try {
    console.log('[OCI SERVICE] Getting storage context...');
    const { objectStorageClient, namespace, bucketName } = getStorageContext();
    console.log('[OCI SERVICE] Storage context retrieved:', {
      namespace,
      bucketName,
      hasClient: !!objectStorageClient
    });

    // Generate unique object name with user-specific prefix
    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1E9);
    const objectName = `videos/${timestamp}-${randomSuffix}-${fileName}`;

    console.log(`[OCI SERVICE] Uploading video: ${objectName} (${fileBuffer.length} bytes)`);

    // Upload the object
    const putObjectRequest = {
      namespaceName: namespace,
      bucketName: bucketName,
      putObjectBody: fileBuffer,
      objectName: objectName,
      contentLength: fileBuffer.length,
      contentType: contentType
    };

    console.log('[OCI SERVICE] putObject request prepared, calling OCI SDK...');
    const uploadResponse = await objectStorageClient.putObject(putObjectRequest);
    console.log('[OCI SERVICE] putObject returned', {
      hasResponse: !!uploadResponse,
      responseType: typeof uploadResponse,
      responseKeys: uploadResponse ? Object.keys(uploadResponse) : []
    });

    // OCI putObject returns a response - success is indicated by no exception thrown
    // opcRequestId might be in different locations or not present in older SDK versions
    const opcRequestId = uploadResponse?.opcRequestId || uploadResponse?.headers?.['opc-requestid'];

    if (!opcRequestId) {
      console.warn('[OCI SERVICE] Upload completed but opcRequestId not found in response - this may indicate SDK version difference');
    }

    console.log(`[OCI SERVICE] Upload successful: ${objectName} (opcRequestId: ${opcRequestId || 'N/A'})`);

    // Create pre-authenticated request for public access
    console.log('[OCI SERVICE] Creating pre-authenticated request...');
    const publicUrl = await createPreAuthenticatedRequest(objectName);

    console.log('[OCI SERVICE] Upload complete, returning:', {
      objectName,
      publicUrl: publicUrl?.substring(0, 50) + '...'
    });

    return {
      objectName,
      publicUrl
    };

  } catch (error) {
    const missingOracleConfig =
      /Missing required Oracle credentials|Oracle Cloud credentials not properly configured/i.test(String(error?.message || ""));
    if (missingOracleConfig) {
      console.warn('[OCI SERVICE] Oracle credentials missing. Falling back to local uploads directory.');
      try {
        return uploadVideoLocally(fileBuffer, fileName);
      } catch (fallbackError) {
        throw new AppError(`Video upload failed (local fallback): ${fallbackError.message}`, 500);
      }
    }

    console.error('[OCI SERVICE] Upload error:', {
      message: error.message,
      name: error.name,
      stack: error.stack?.substring(0, 300)
    });
    throw new AppError(`Video upload failed: ${error.message}`, 500);
  }
}

/**
 * Create a pre-authenticated request for an object
 * @param {string} objectName - The object name
 * @returns {Promise<string>} - The public URL
 */
async function createPreAuthenticatedRequest(objectName) {
  console.log('[OCI SERVICE] createPreAuthenticatedRequest called for:', objectName);
  try {
    const { objectStorageClient, namespace, bucketName } = getStorageContext();
    console.log('[OCI SERVICE] Creating PAR with:', { namespace, bucketName });

    const parRequest = {
      namespaceName: namespace,
      bucketName: bucketName,
      createPreauthenticatedRequestDetails: {
        name: `video-${Date.now()}`,
        objectName: objectName,
        accessType: os.models.CreatePreauthenticatedRequestDetails.AccessType.ObjectRead,
        timeExpires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
      }
    };

    console.log('[OCI SERVICE] Calling createPreauthenticatedRequest...');
    const parResponse = await objectStorageClient.createPreauthenticatedRequest(parRequest);
    console.log('[OCI SERVICE] PAR response:', {
      hasResponse: !!parResponse,
      hasPreauthenticatedRequest: !!parResponse?.preauthenticatedRequest
    });

    if (!parResponse.preauthenticatedRequest) {
      console.error('[OCI SERVICE] PAR response missing preauthenticatedRequest');
      throw new AppError('Failed to create public URL for video', 500);
    }

    const publicUrl = parResponse.preauthenticatedRequest.fullPath;
    console.log(`[OCI SERVICE] Pre-authenticated request created: ${publicUrl?.substring(0, 50)}...`);

    return publicUrl;

  } catch (error) {
    console.error('[OCI SERVICE] Pre-authenticated request error:', {
      message: error.message,
      name: error.name,
      stack: error.stack?.substring(0, 200)
    });
    // If we can't create PAR, attempt to delete the uploaded object
    try {
      await deleteVideoFromOCI(objectName);
    } catch (deleteError) {
      console.error('[OCI] Failed to cleanup after PAR error:', deleteError);
    }
    throw new AppError(`Failed to create public URL: ${error.message}`, 500);
  }
}

/**
 * Delete a video from Object Storage
 * @param {string} videoUrl - The public URL or object name
 */
async function deleteVideo(videoUrl) {
  try {
    let objectName = String(videoUrl || '').trim();

    // Local fallback URLs are served as /uploads/<objectName>
    if (objectName.includes('/uploads/')) {
      const markerIndex = objectName.indexOf('/uploads/');
      const relativeObjectName = objectName.slice(markerIndex + '/uploads/'.length);
      const localPath = resolveLocalPathFromObjectName(relativeObjectName);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
      return;
    }

    const { objectStorageClient, namespace, bucketName } = getStorageContext();
    if (objectName.startsWith('http')) {
      const urlParts = objectName.split('/');
      objectName = urlParts.slice(-2).join('/');
    }

    const deleteRequest = {
      namespaceName: namespace,
      bucketName: bucketName,
      objectName: objectName
    };

    await objectStorageClient.deleteObject(deleteRequest);
    console.log(`[OCI] Video deleted: ${objectName}`);

  } catch (error) {
    console.error('[OCI] Delete error:', error);
    // Don't throw - allow database deletion to proceed
  }
}

/**
 * Internal: Delete video from OCI (for rollback)
 */
async function deleteVideoFromOCI(objectName) {
  const { objectStorageClient, namespace, bucketName } = getStorageContext();
  const deleteRequest = {
    namespaceName: namespace,
    bucketName: bucketName,
    objectName: objectName
  };
  await objectStorageClient.deleteObject(deleteRequest);
}

module.exports = {
  uploadVideo,
  deleteVideo
};
