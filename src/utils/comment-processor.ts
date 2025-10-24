/**
 * Comment Processing Utility - Shared logic for processing GitHub comments
 */

import { logger } from './logger';

export interface CommentData {
  user: { login: string };
  body: string;
  created_at: string;
  path?: string;
  line?: number;
  diff_hunk?: string;
  state?: string;
  submitted_at?: string;
  id?: number;
  resolved?: boolean;
}

interface CommentProcessingOptions {
  commentPrefix: string;
  currentUser?: string | null;
  skipUsernameCheck?: boolean;
}

/**
 * Filter comments based on prefix and user
 * Note: Resolved status and timestamp filtering should be done before calling this
 */
function filterComments(
  comments: CommentData[],
  options: CommentProcessingOptions
): CommentData[] {
  const { commentPrefix, currentUser, skipUsernameCheck } = options;

  return comments.filter((comment) => {
    const startsWithPrefix = comment.body?.trim().startsWith(commentPrefix);

    // Check username only if skipUsernameCheck is false
    const isFromCurrentUser = skipUsernameCheck
      ? true
      : currentUser && comment.user.login === currentUser;

    logger.info(
      `Comment by ${comment.user.login}, ` +
        `id ${comment.id || 'none'}, ` +
        `starts with '${commentPrefix}': ${startsWithPrefix}, ` +
        `from current user (${currentUser}): ${isFromCurrentUser}, ` +
        `skip username check: ${skipUsernameCheck}`
    );

    return startsWithPrefix && isFromCurrentUser;
  });
}

/**
 * Process and format comments for display
 */
export function processAllComments(
  comments: CommentData[],
  options: CommentProcessingOptions
): string[] {
  const filteredComments = filterComments(comments, options);

  return filteredComments.map((comment) => {
    let formatted = `Comment by ${comment.user.login}`;
    if (comment.state) formatted += ` (${comment.state})`;
    formatted += ':\n';

    // Add file/line context if available
    if (comment.path) formatted += `File: ${comment.path}\n`;
    if (comment.line !== undefined) formatted += `Line: ${comment.line}\n`;
    if (comment.diff_hunk) formatted += `Context: ${comment.diff_hunk}\n`;

    if (comment.body && comment.body.trim()) {
      formatted += `${comment.body}\n`;
    }
    return formatted.trim();
  });
}
