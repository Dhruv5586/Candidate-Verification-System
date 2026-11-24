import { validationIssueRepository } from '../repositories/validationIssue.repository';
import { CandidateRecord, ValidationIssueRecord, IssueSeverity } from '../types/candidate.types';
import { logger } from '../utils/logger';

export class ResumeValidationService {
  /**
   * Run 10 rule-based verification checks against the extracted resume text and candidate profile.
   * Stores issues into validation_issues. Never automatically flags as fraud; issues require reviewer review.
   */
  public async validateResume(
    candidate: CandidateRecord,
    documentId: string,
    extractedText: string,
    verificationId?: string
  ): Promise<ValidationIssueRecord[]> {
    const text = (extractedText || '').trim();
    const lowerText = text.toLowerCase();
    const createdIssues: ValidationIssueRecord[] = [];

    const recordIssue = async (params: {
      severity: IssueSeverity;
      issueType: string;
      description: string;
    }) => {
      const issue = await validationIssueRepository.create({
        candidateId: candidate.id,
        documentId,
        verificationId: verificationId || null,
        severity: params.severity,
        issueType: params.issueType,
        description: params.description,
      });
      createdIssues.push(issue);
      return issue;
    };

    // 1. Empty or Unreadable Text Check
    if (!text || text.length < 50) {
      await recordIssue({
        severity: 'critical',
        issueType: 'EMPTY_OR_UNREADABLE_DOCUMENT',
        description: 'Uploaded resume contains insufficient or unreadable text content.',
      });
      return createdIssues;
    }

    // 2. Candidate Name Presence Check
    const nameParts = candidate.full_name.trim().toLowerCase().split(/\s+/);
    const hasNameMatch = nameParts.some((part) => part.length > 2 && lowerText.includes(part));
    if (!hasNameMatch) {
      await recordIssue({
        severity: 'medium',
        issueType: 'NAME_NOT_FOUND',
        description: `Candidate name '${candidate.full_name}' was not detected in the parsed resume text.`,
      });
    }

    // 3. Email Format & Presence Check
    const candidateEmail = candidate.email.toLowerCase();
    if (!lowerText.includes(candidateEmail)) {
      await recordIssue({
        severity: 'high',
        issueType: 'EMAIL_MISMATCH',
        description: `Candidate profile email '${candidate.email}' was not found in the resume text.`,
      });
    }

    // 4. Phone Format & Presence Check
    if (candidate.phone) {
      const digitsOnly = candidate.phone.replace(/\D/g, '');
      if (digitsOnly.length >= 7 && !text.replace(/\D/g, '').includes(digitsOnly)) {
        await recordIssue({
          severity: 'low',
          issueType: 'PHONE_NOT_DETECTED',
          description: `Registered phone number '${candidate.phone}' was not detected in the resume text.`,
        });
      }
    }

    // 5. Education Section Presence Check
    const educationRegex = /\b(education|academic|degree|bachelor|master|university|college|b\.?tech|b\.?s|m\.?s|ph\.?d|diploma)\b/i;
    if (!educationRegex.test(lowerText)) {
      await recordIssue({
        severity: 'medium',
        issueType: 'EDUCATION_SECTION_MISSING',
        description: 'No recognized education or academic credential section was detected.',
      });
    }

    // 6. Experience / Employment Section Check
    const experienceRegex = /\b(experience|employment|work history|career|internship|professional experience|projects)\b/i;
    if (!experienceRegex.test(lowerText)) {
      await recordIssue({
        severity: 'low',
        issueType: 'EXPERIENCE_SECTION_MISSING',
        description: 'No recognized work experience or career history section was detected.',
      });
    }

    // 7. Obvious Invalid Date Ranges (e.g. 2024 - 2018 where end < start)
    const rangeRegex = /\b(19\d\d|20\d\d)\s*[-–to]+\s*(19\d\d|20\d\d)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = rangeRegex.exec(text)) !== null) {
      const startYear = parseInt(match[1], 10);
      const endYear = parseInt(match[2], 10);
      if (endYear < startYear) {
        await recordIssue({
          severity: 'critical',
          issueType: 'INVALID_DATE_RANGE',
          description: `Detected inverted chronological date range: ${match[0]} (end year precedes start year).`,
        });
        break; // Log once per document
      }
    }

    // 8. Future Date Range Anomaly (years > current year + 2)
    const currentYear = new Date().getFullYear();
    const futureYearRegex = /\b(20[3-9]\d)\b/g;
    let futureMatch: RegExpExecArray | null;
    while ((futureMatch = futureYearRegex.exec(text)) !== null) {
      const year = parseInt(futureMatch[1], 10);
      if (year > currentYear + 2) {
        await recordIssue({
          severity: 'medium',
          issueType: 'FUTURE_DATE_ANOMALY',
          description: `Detected anomalous future year reference: ${year}.`,
        });
        break;
      }
    }

    // 9. Date Format Consistency Check
    const hasIsoDates = /\b(19\d\d|20\d\d)[-/](0[1-9]|1[0-2])\b/.test(text);
    const hasSpelledDates = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(19\d\d|20\d\d)\b/i.test(text);
    if (!hasIsoDates && !hasSpelledDates) {
      await recordIssue({
        severity: 'low',
        issueType: 'UNCONVENTIONAL_DATE_FORMAT',
        description: 'No standardized date formats were recognized in the employment or education history.',
      });
    }

    // 10. Missing Important Contact Information
    if (!candidate.phone && !candidate.location) {
      await recordIssue({
        severity: 'low',
        issueType: 'INCOMPLETE_CONTACT_METADATA',
        description: 'Candidate profile lacks phone number and location details.',
      });
    }

    logger.info(
      { candidateId: candidate.id, documentId, verificationId, issuesCount: createdIssues.length },
      'Resume rule-based validation completed'
    );

    return createdIssues;
  }
}

export const resumeValidationService = new ResumeValidationService();
