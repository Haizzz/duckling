/**
 * Comment Processing Utility - Shared logic for processing GitHub comments
 */

import { logger } from './logger';

export interface CommentData {
  id?: number;
  user: { login: string };
  body: string;
  created_at: string;
  path?: string;
  line?: number;
  diff_hunk?: string;
  state?: string;
  submitted_at?: string;
}

interface CommentProcessingOptions {
  commentPrefix: string;
  lastCommitTimestamp: string | null;
  currentUser?: string | null;
  skipUsernameCheck?: boolean;
}

/**
 * Filter comments based on prefix, timestamp, and user
 */
function filterComments(
  comments: CommentData[],
  options: CommentProcessingOptions
): CommentData[] {
  const { commentPrefix, lastCommitTimestamp, currentUser, skipUsernameCheck } =
    options;
  const lastCommitDate = lastCommitTimestamp
    ? new Date(lastCommitTimestamp)
    : null;

  return comments.filter((comment) => {
    const startsWithPrefix = comment.body?.trim().startsWith(commentPrefix);
    const commentDate = new Date(
      comment.created_at || comment.submitted_at || ''
    );
    const isNewerThanCommit = lastCommitDate
      ? commentDate > lastCommitDate
      : true;

    // Check username only if skipUsernameCheck is false
    const isFromCurrentUser = skipUsernameCheck
      ? true
      : currentUser && comment.user.login === currentUser;

    logger.info(
      `Comment by ${comment.user.login}, ` +
        `time ${commentDate}, commit time ${lastCommitDate || 'null'}, ` +
        `starts with '${commentPrefix}': ${startsWithPrefix}, ` +
        `from current user (${currentUser}): ${isFromCurrentUser}, ` +
        `skip username check: ${skipUsernameCheck}`
    );

    return startsWithPrefix && isNewerThanCommit && isFromCurrentUser;
  });
}

/**
 * Format PR comments for display
 */
function formatPRComments(comments: CommentData[]): string[] {
  return comments.map((comment) => {
    const commentString = `Comment by ${comment.user.login}:\n${comment.body}\n`;
    return commentString.trim();
  });
}

/**
 * Format review comments for display (includes both review body and line comments)
 */
function formatReviewComments(comments: CommentData[]): string[] {
  return comments.map((comment) => {
    let commentString = `Review by ${comment.user.login}`;
    if (comment.state) {
      commentString += ` (${comment.state})`;
    }
    commentString += ':\n';

    // Add file/line info if it's a line comment
    if (comment.path) commentString += `File: ${comment.path}\n`;
    if (comment.line !== undefined) commentString += `Line: ${comment.line}\n`;
    if (comment.diff_hunk) commentString += `Context: ${comment.diff_hunk}\n`;

    if (comment.body && comment.body.trim()) {
      commentString += `${comment.body}\n`;
    }
    return commentString.trim();
  });
}

/**
 * Process all comment types and return formatted results
 */
export function processAllComments(
  prComments: CommentData[],
  allReviewComments: CommentData[],
  options: CommentProcessingOptions
): string[] {
  const formattedComments: string[] = [];

  // Process PR comments
  const filteredPrComments = filterComments(prComments, options);
  formattedComments.push(...formatPRComments(filteredPrComments));

  // Process all review comments (both body and line comments)
  const filteredReviewComments = filterComments(allReviewComments, options);
  formattedComments.push(...formatReviewComments(filteredReviewComments));

  return formattedComments;
}
