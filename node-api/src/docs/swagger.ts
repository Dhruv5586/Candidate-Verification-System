export const swaggerDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Candidate Verification System - Node.js API',
    version: '1.0.0',
    description: 'Business logic, candidate management, CSV ingestion, and verification workflow engine.',
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API Version 1',
    },
  ],
  components: {
    securitySchemes: {
      CookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'cvs_session',
        description: 'HTTP-only session cookie issued by Go Auth service',
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Optional Bearer session token header for API clients',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Service health check',
        description: 'Returns operational status, uptime, and environment details.',
        responses: {
          200: {
            description: 'Service is operational',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', example: 'healthy' },
                        service: { type: 'string', example: 'candidate-verification-node-api' },
                        version: { type: 'string', example: '1.0.0' },
                        uptimeSeconds: { type: 'number', example: 42 },
                        timestamp: { type: 'string', example: '2026-11-23T12:00:00.000Z' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/health/database': {
      get: {
        tags: ['Health'],
        summary: 'Database connection health check',
        description: 'Checks connectivity to the PostgreSQL candidate_verification database.',
        responses: {
          200: {
            description: 'PostgreSQL connection active',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', example: 'connected' },
                        database: { type: 'string', example: 'PostgreSQL (candidate_verification)' },
                        responseTimeMs: { type: 'number', example: 5 },
                        timestamp: { type: 'string', example: '2026-11-23T12:00:00.000Z' },
                      },
                    },
                  },
                },
              },
            },
          },
          503: {
            description: 'Database connection failed',
          },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get current authenticated user profile',
        description: 'Validates session cookie or Bearer token with Go Auth and returns verified user identity and active roles.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        responses: {
          200: {
            description: 'Authenticated user profile retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        user: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', format: 'uuid', example: '11111111-1111-1111-1111-111111111111' },
                            email: { type: 'string', format: 'email', example: 'recruiter@example.com' },
                            name: { type: 'string', example: 'Jane Recruiter' },
                            roles: {
                              type: 'array',
                              items: { type: 'string' },
                              example: ['recruiter'],
                            },
                          },
                        },
                        session: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', format: 'uuid', example: '22222222-2222-2222-2222-222222222222' },
                            expiresAt: { type: 'string', format: 'date-time', example: '2026-11-30T12:00:00.000Z' },
                          },
                        },
                      },
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        timestamp: { type: 'string', example: '2026-11-23T12:00:00.000Z' },
                        version: { type: 'string', example: 'v1' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Missing, invalid, expired, or revoked session token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: {
                      type: 'object',
                      properties: {
                        code: { type: 'string', example: 'UNAUTHORIZED' },
                        message: { type: 'string', example: 'Authentication required: missing session token' },
                      },
                    },
                  },
                },
              },
            },
          },
          503: {
            description: 'Go Auth service temporarily unavailable or request timed out',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: {
                      type: 'object',
                      properties: {
                        code: { type: 'string', example: 'SERVICE_UNAVAILABLE' },
                        message: { type: 'string', example: 'Authentication service is currently unavailable' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/rbac/admin': {
      get: {
        tags: ['Role-Based Access Control'],
        summary: 'Admin protected endpoint',
        description: 'Requires authenticated user with admin role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        responses: {
          200: { description: 'Admin access authorized' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: requires admin role' },
        },
      },
    },
    '/rbac/recruiter': {
      get: {
        tags: ['Role-Based Access Control'],
        summary: 'Recruiter protected endpoint',
        description: 'Requires authenticated user with recruiter role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        responses: {
          200: { description: 'Recruiter access authorized' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: requires recruiter role' },
        },
      },
    },
    '/rbac/reviewer': {
      get: {
        tags: ['Role-Based Access Control'],
        summary: 'Reviewer protected endpoint',
        description: 'Requires authenticated user with reviewer role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        responses: {
          200: { description: 'Reviewer access authorized' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: requires reviewer role' },
        },
      },
    },
    '/rbac/roles/assign': {
      post: {
        tags: ['Role-Based Access Control'],
        summary: 'Assign role to user (Admin only)',
        description: 'Assigns a role to a target user and logs to audit_logs table.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['targetUserId', 'roleName'],
                properties: {
                  targetUserId: { type: 'string', format: 'uuid' },
                  roleName: { type: 'string', enum: ['admin', 'recruiter', 'reviewer'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Role assigned successfully' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: only admin can assign roles' },
        },
      },
    },
    '/candidates': {
      post: {
        tags: ['Candidates'],
        summary: 'Create a new candidate',
        description: 'Creates a candidate record with normalized email and phone. Requires admin or recruiter role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fullName', 'email'],
                properties: {
                  fullName: { type: 'string', example: 'Alex Morgan' },
                  email: { type: 'string', format: 'email', example: 'alex.morgan@example.com' },
                  phone: { type: 'string', example: '+1-555-0199' },
                  location: { type: 'string', example: 'San Francisco, CA' },
                  currentJobTitle: { type: 'string', example: 'Senior Software Engineer' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Candidate created successfully' },
          400: { description: 'Validation failed' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: recruiter or admin only' },
          409: { description: 'Conflict: candidate with email already exists' },
        },
      },
      get: {
        tags: ['Candidates'],
        summary: 'List candidates with pagination and search',
        description: 'Returns paginated candidate list. Accessible by admin, recruiter, or reviewer.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Candidate list returned successfully' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
        },
      },
    },
    '/candidates/{id}': {
      get: {
        tags: ['Candidates'],
        summary: 'Get candidate by ID',
        description: 'Retrieves single candidate record including documents count.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Candidate details returned' },
          401: { description: 'Unauthenticated' },
          404: { description: 'Candidate not found' },
        },
      },
      patch: {
        tags: ['Candidates'],
        summary: 'Update candidate',
        description: 'Updates candidate details. Requires admin or recruiter role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fullName: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  phone: { type: 'string' },
                  location: { type: 'string' },
                  currentJobTitle: { type: 'string' },
                  status: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Candidate updated successfully' },
          400: { description: 'Invalid input' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
          404: { description: 'Candidate not found' },
          409: { description: 'Email conflict with another candidate' },
        },
      },
      delete: {
        tags: ['Candidates'],
        summary: 'Soft delete candidate (Admin only)',
        description: 'Marks candidate as deleted without removing historical audit logs.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Candidate soft deleted' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: admin only' },
          404: { description: 'Candidate not found' },
        },
      },
    },
    '/candidates/{id}/resumes': {
      post: {
        tags: ['Resumes'],
        summary: 'Upload resume for candidate',
        description: 'Uploads PDF or DOCX resume, validates magic bytes, extracts text, and evaluates rule-based validation checks. Requires admin or recruiter role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary', description: 'Resume file (.pdf or .docx, max 5MB)' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Resume uploaded, extracted, and validated successfully' },
          400: { description: 'Invalid file type, invalid magic bytes, or corrupt file' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
          404: { description: 'Candidate not found' },
          409: { description: 'Duplicate document checksum already uploaded' },
        },
      },
      get: {
        tags: ['Resumes'],
        summary: 'List candidate resumes',
        description: 'Returns all uploaded resume documents for the candidate with validation summary.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Resume list returned' },
          401: { description: 'Unauthenticated' },
          404: { description: 'Candidate not found' },
        },
      },
    },
    '/resumes/{documentId}': {
      get: {
        tags: ['Resumes'],
        summary: 'Get resume details and validation report',
        description: 'Returns document metadata, extracted sections, and 10 rule-based validation issue checks.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Resume details, extraction, and validation issues returned' },
          401: { description: 'Unauthenticated' },
          404: { description: 'Document not found' },
        },
      },
    },
    '/resumes/{documentId}/download': {
      get: {
        tags: ['Resumes'],
        summary: 'Download resume document stream',
        description: 'Streams resume securely from private filesystem. Requires authenticated user with admin, recruiter, or reviewer role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'documentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: 'Resume file stream',
            content: {
              'application/pdf': { schema: { type: 'string', format: 'binary' } },
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { schema: { type: 'string', format: 'binary' } },
            },
          },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
          404: { description: 'Document or storage file not found' },
        },
      },
    },
    '/imports/csv/preview': {
      post: {
        tags: ['Imports'],
        summary: 'Preview CSV file with comprehensive duplicate detection',
        description: 'Analyzes CSV rows against CSV and PostgreSQL candidates. Detects NEW, INVALID, DUPLICATE_IN_DATABASE, and DUPLICATE_IN_CSV rows without inserting records. Requires admin or recruiter role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary', description: 'CSV file (.csv, max 5MB)' },
                },
              },
            },
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  batchId: { type: 'string', format: 'uuid', description: 'Reference to previously uploaded batch' },
                  csvContent: { type: 'string', description: 'Raw CSV text content' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Preview summary, row details, and duplicate detection results returned' },
          400: { description: 'Invalid CSV format or missing content' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: admin or recruiter only' },
          404: { description: 'Batch not found (if batchId specified)' },
        },
      },
    },
    '/imports/{importId}/confirm': {
      post: {
        tags: ['Imports'],
        summary: 'Confirm and import eligible candidates into PostgreSQL',
        description: 'Performs transactional import of eligible candidates classified as NEW by server-side preview. Idempotent; skips duplicates and invalid rows. Requires admin or owning recruiter role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'importId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['confirm'],
                properties: {
                  confirm: { type: 'boolean', example: true, description: 'Explicit confirmation flag' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Import confirmed and candidates inserted successfully with summary counts' },
          400: { description: 'Missing confirmation or invalid batch state' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: unauthorized or reviewer role' },
          404: { description: 'Import batch not found' },
          409: { description: 'Batch is currently being processed' },
        },
      },
    },
    '/imports/upload': {
      post: {
        tags: ['Imports'],
        summary: 'Upload CSV file for candidate bulk ingestion',
        description: 'Uploads CSV file, validates format, stores file privately, and returns header mapping and row preview. Requires admin or recruiter role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary', description: 'CSV file (.csv, max 5MB)' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'CSV uploaded and preview generated successfully' },
          400: { description: 'Invalid CSV format or missing file' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: admin or recruiter only' },
        },
      },
    },
    '/imports/{batchId}/execute': {
      post: {
        tags: ['Imports'],
        summary: 'Execute batch ingestion of uploaded CSV candidates',
        description: 'Processes candidate records in chunked transactions, validates email format and duplicate constraints, and tracks errors. Requires admin or owning recruiter.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'batchId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Batch executed successfully with summary counts' },
          400: { description: 'Invalid batch state or missing file' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
          404: { description: 'Batch not found' },
          409: { description: 'Batch already processing or completed' },
        },
      },
    },
    '/imports/{batchId}': {
      get: {
        tags: ['Imports'],
        summary: 'Get import batch status and summary',
        description: 'Retrieves batch processing progress, row counts, and error summary. Accessible by admin or owning recruiter.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'batchId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Batch status returned' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
          404: { description: 'Batch not found' },
        },
      },
    },
    '/imports': {
      get: {
        tags: ['Imports'],
        summary: 'List import batches with pagination',
        description: 'Returns paginated import batches. Recruiters see their own; admins see all.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Batch list returned' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
        },
      },
    },
    '/candidates/{id}/claims': {
      post: {
        tags: ['Claims & Verifications'],
        summary: 'Add credential claim to candidate',
        description: 'Adds education, employment, certification, or other verifiable claim to candidate profile. Requires admin or recruiter role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['claim_type', 'organization_name'],
                properties: {
                  claim_type: { type: 'string', enum: ['education', 'employment', 'identity', 'criminal_check', 'certification', 'reference'] },
                  organization_name: { type: 'string' },
                  title_or_degree: { type: 'string' },
                  start_date: { type: 'string', format: 'date' },
                  end_date: { type: 'string', format: 'date' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Claim added successfully' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
          404: { description: 'Candidate not found' },
        },
      },
      get: {
        tags: ['Claims & Verifications'],
        summary: 'List candidate credential claims',
        description: 'Returns all claims for candidate. Accessible by admin, recruiter, or reviewer.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Claims list returned' },
          401: { description: 'Unauthenticated' },
          404: { description: 'Candidate not found' },
        },
      },
    },
    '/verifications': {
      post: {
        tags: ['Claims & Verifications'],
        summary: 'Create verification task for candidate/claim',
        description: 'Creates human verification review task with priority and optional reviewer assignment. Requires admin or recruiter.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['candidate_id'],
                properties: {
                  candidate_id: { type: 'string', format: 'uuid' },
                  claim_id: { type: 'string', format: 'uuid' },
                  reviewer_id: { type: 'string', format: 'uuid' },
                  priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Verification task created' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
          404: { description: 'Candidate or claim not found' },
        },
      },
      get: {
        tags: ['Claims & Verifications'],
        summary: 'Get verification review queue',
        description: 'Returns review tasks prioritized by urgency. Accessible by Reviewers and Admins (Recruiters strictly forbidden).',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'passed', 'failed', 'requires_review'] } },
          { name: 'priority', in: 'query', schema: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Verification review queue returned' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: reviewers and admins only' },
        },
      },
    },
    '/verifications/{id}/assign': {
      post: {
        tags: ['Claims & Verifications'],
        summary: 'Assign reviewer to verification task',
        description: 'Assigns an active reviewer to a verification task. Requires admin or recruiter role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reviewerId'],
                properties: {
                  reviewerId: { type: 'string', format: 'uuid' },
                  priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Reviewer assigned successfully' },
          400: { description: 'Invalid reviewer ID or user lacks reviewer role' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: admin or authorized recruiter only' },
          404: { description: 'Verification not found' },
          409: { description: 'Conflict: verification already assigned to this reviewer' },
        },
      },
      patch: {
        tags: ['Claims & Verifications'],
        summary: 'Assign reviewer to verification task (Admin only)',
        description: 'Assigns or reassigns task to a reviewer. Requires admin role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reviewer_id'],
                properties: {
                  reviewer_id: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Reviewer assigned successfully' },
          400: { description: 'Target user does not have reviewer privileges' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: admin only' },
          404: { description: 'Verification not found' },
        },
      },
    },
    '/verifications/{id}/review': {
      post: {
        tags: ['Claims & Verifications'],
        summary: 'Submit verification review decision',
        description: 'Submits review decision (passed, failed, requires_review) with mandatory notes. Synchronizes claim and candidate statuses. Reviewers and Admins only (Recruiters strictly forbidden).',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status', 'notes'],
                properties: {
                  status: { type: 'string', enum: ['passed', 'failed', 'requires_review'] },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Verification review submitted successfully' },
          400: { description: 'Validation failed' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: recruiters cannot review' },
          404: { description: 'Verification not found' },
        },
      },
    },
    '/candidates/{id}/verifications': {
      post: {
        tags: ['Claims & Verifications'],
        summary: 'Initiate automated candidate verification workflow',
        description: 'Runs automated 10-rule resume screening checks and creates a verification task. Requires admin or recruiter role.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Verification workflow initiated and automated checks executed' },
          400: { description: 'Candidate has no uploaded resume' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: unauthorized access' },
          404: { description: 'Candidate not found' },
          409: { description: 'Active verification already in progress' },
        },
      },
      get: {
        tags: ['Claims & Verifications'],
        summary: 'List verifications for candidate',
        description: 'Returns all verification tasks linked to the candidate. Requires admin, candidate recruiter, or reviewer.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Verifications list returned' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
          404: { description: 'Candidate not found' },
        },
      },
    },
    '/verifications/{id}': {
      get: {
        tags: ['Claims & Verifications'],
        summary: 'Get verification details',
        description: 'Retrieves single verification task record. Requires admin, candidate recruiter, or reviewer.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Verification details returned' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
          404: { description: 'Verification not found' },
        },
      },
    },
    '/verifications/{id}/issues': {
      get: {
        tags: ['Claims & Verifications'],
        summary: 'Get validation issues for verification task',
        description: 'Returns automated screening issues detected for this verification task. Requires admin, candidate recruiter, or reviewer.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          200: { description: 'Validation issues returned' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden' },
          404: { description: 'Verification not found' },
        },
      },
    },
    '/reviewer/assignments': {
      get: {
        tags: ['Reviewer Workflow'],
        summary: 'List reviewer assignments',
        description: 'Returns only verification tasks strictly assigned to the authenticated reviewer. Reviewers cannot view other reviewers assignments.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'passed', 'failed', 'requires_review'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'Assigned verifications queue returned' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: reviewer role required' },
        },
      },
    },
    '/reviewer/assignments/{verificationId}': {
      get: {
        tags: ['Reviewer Workflow'],
        summary: 'Get assigned verification details',
        description: 'Retrieves candidate profile, resume metadata, download link, automated verification results, validation issues, and audit review history. Enforces reviewer ownership.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'verificationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Reviewer assignment details returned' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: task not assigned to authenticated reviewer' },
          404: { description: 'Verification assignment not found' },
        },
      },
    },
    '/reviewer/assignments/{verificationId}/decision': {
      post: {
        tags: ['Reviewer Workflow'],
        summary: 'Submit reviewer decision',
        description: 'Submits human reviewer decision (APPROVED, REJECTED, NEEDS_INFORMATION) with mandatory reason comments for rejection or clarification. Updates verification status and synchronizes candidate status.',
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: 'verificationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['decision'],
                properties: {
                  decision: { type: 'string', enum: ['APPROVED', 'REJECTED', 'NEEDS_INFORMATION'] },
                  comment: { type: 'string', description: 'Reviewer explanation notes (mandatory for REJECTED/NEEDS_INFORMATION)' },
                  reason: { type: 'string', description: 'Alternative alias for comment' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Review decision submitted and status synchronized successfully' },
          400: { description: 'Invalid decision or missing mandatory comment' },
          401: { description: 'Unauthenticated' },
          403: { description: 'Forbidden: not assigned reviewer or conflict of interest' },
          404: { description: 'Verification assignment not found' },
          409: { description: 'Conflict: decision already submitted' },
        },
      },
    },
  },
};
