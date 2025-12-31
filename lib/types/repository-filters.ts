/**
 * Repository Filter Types
 *
 * Define filter interfaces for repository queries.
 * Keeps filtering logic consistent across all repositories.
 */

export interface EmailFilters {
  threadId?: string;
  hasAttachments?: boolean;
  search?: string;
  documentType?: string[];
  confidenceLevel?: string[];
  needsReview?: boolean;
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
