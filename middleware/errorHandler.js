// Centralized error handling middleware

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    err.statusCode = 413;
    err.message = 'Video file is too large (max 50MB).';
  }

  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Always log the error for debugging
  console.error('API Error:', {
    message: err.message,
    statusCode: err.statusCode,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  if (process.env.NODE_ENV === 'development') {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      stack: err.stack,
    });
  } else {
    // Production: show error message but not stack trace
    // Always show the error message for API debugging
    res.status(err.statusCode).json({
      success: false,
      error: err.message || 'Something went wrong',
    });
  }
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { AppError, errorHandler, asyncHandler };
