/**
 * Candidate Verification System - Real Dataset Seeder
 * Reads candidates from dataset/job_applicant_dataset.csv and inserts them into PostgreSQL.
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { pool } from '../src/config/database';

async function seed(limit = 10) {
  const client = await pool.connect();
  try {
    console.log('Connecting to PostgreSQL candidate_verification database...');

    // 1. Get primary registered user
    const userRes = await client.query('SELECT id, email, name FROM users ORDER BY created_at ASC LIMIT 1;');
    if (userRes.rows.length === 0) {
      console.error('No registered user found in users table.');
      return;
    }
    const adminUser = userRes.rows[0];
    console.log(`Using recruiter/admin user: ${adminUser.name} (${adminUser.email})`);

    // 2. Read dataset CSV
    const csvPath = path.resolve(__dirname, '../../CandidateVerificationSystem/dataset/job_applicant_dataset.csv');
    if (!fs.existsSync(csvPath)) {
      console.error(`Dataset file not found at: ${csvPath}`);
      return;
    }
    console.log(`Reading dataset from: ${csvPath}`);
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    console.log(`Found ${records.length} applicants in CSV. Seeding ${limit} candidates into PostgreSQL...`);

    let inserted = 0;
    let skipped = 0;

    await client.query('BEGIN');

    for (let i = 0; i < Math.min(records.length, limit); i++) {
      const rec = records[i];
      const fullName = (rec['Job Applicant Name'] || '').trim();
      if (!fullName) continue;

      const names = fullName.split(/\s+/);
      const firstName = names[0] || '';
      const lastName = names.slice(1).join(' ') || '';
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z0-9]/g, '')}@applicant.example.com`;
      const jobTitle = (rec['Job Roles'] || '').trim();
      const resumeText = (rec['Resume'] || '').trim();
      const ethnicity = (rec['Ethnicity'] || '').trim();
      const ethnicityToCountry: Record<string, string> = {
        'English': 'United Kingdom',
        'Irish': 'Ireland',
        'Vietnamese': 'Vietnam',
        'Filipino': 'Philippines',
        'Dutch': 'Netherlands',
        'Caribbean': 'Caribbean',
        'African': 'South Africa',
        'Thai': 'Thailand',
        'French': 'France',
        'Indian': 'India',
        'Ethiopian': 'Ethiopia',
        'Korean': 'South Korea',
        'Kenyan': 'Kenya',
        'Italian': 'Italy',
        'Polish': 'Poland',
        'Jamaican': 'Jamaica',
        'Chinese': 'China',
        'German': 'Germany',
        'Nigerian': 'Nigeria',
        'Japanese': 'Japan',
        'Ghanaian': 'Ghana'
      };
      const location = ethnicityToCountry[ethnicity] || ethnicity || 'Unknown';

      // Check if already exists
      const existing = await client.query('SELECT id FROM candidates WHERE email = $1;', [email]);
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      // Insert candidate
      const candRes = await client.query(
        `INSERT INTO candidates (
          first_name, last_name, full_name, email, current_job_title, location, status, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW(), NOW())
        RETURNING id;`,
        [firstName, lastName, fullName, email, jobTitle, location, adminUser.id]
      );
      const candidateId = candRes.rows[0].id;

      // Insert synthetic resume document
      const docRes = await client.query(
        `INSERT INTO documents (
          candidate_id, file_name, file_type, file_size_bytes, storage_key, checksum_sha256, document_type, upload_status, uploaded_by, created_at
        ) VALUES ($1, $2, 'application/pdf', $3, $4, $5, 'resume', 'completed', $6, NOW())
        RETURNING id;`,
        [
          candidateId,
          `${firstName.toLowerCase()}_${lastName.toLowerCase()}_resume.pdf`,
          Buffer.byteLength(resumeText),
          `synthetic_${candidateId}.pdf`,
          `sha256_dataset_${candidateId.replace(/-/g, '')}`,
          adminUser.id,
        ]
      );
      const documentId = docRes.rows[0].id;

      // Insert resume extraction record
      if (resumeText) {
        await client.query(
          `INSERT INTO resume_extractions (
            document_id, extracted_text, extracted_data, extraction_status, parser_name, parser_version, created_at
          ) VALUES ($1, $2, $3, 'completed', 'dataset-importer', '1.0.0', NOW());`,
          [documentId, resumeText, JSON.stringify({ summary: resumeText, experience: rec['Job Description'] || '' })]
        );
      }

      inserted++;
    }

    await client.query('COMMIT');
    console.log(`\nSuccessfully seeded database!`);
    console.log(` - Inserted candidates: ${inserted}`);
    console.log(` - Skipped duplicates : ${skipped}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during seeding:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

const count = parseInt(process.argv[2] || '10', 10);
seed(count);
