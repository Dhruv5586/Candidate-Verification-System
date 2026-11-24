/**
 * High-Performance Dataset Importer
 * Streams job_applicant_dataset.csv and imports remaining candidates into PostgreSQL.
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import { pool } from '../src/config/database';

async function seedAll(maxToImport = 500) {
  const startTime = Date.now();
  const client = await pool.connect();

  try {
    console.log('Connecting to PostgreSQL candidate_verification...');

    // 1. Get primary user
    const userRes = await client.query('SELECT id, email, name FROM users ORDER BY created_at ASC LIMIT 1;');
    if (userRes.rows.length === 0) {
      console.error('No registered user found in users table.');
      return;
    }
    const adminUser = userRes.rows[0];
    console.log(`Using admin/recruiter user: ${adminUser.name} (${adminUser.email})`);

    // 2. Load existing candidate emails into a fast in-memory Set
    const existingRes = await client.query('SELECT email FROM candidates;');
    const existingEmails = new Set(existingRes.rows.map(r => r.email.toLowerCase()));
    console.log(`Found ${existingEmails.size} candidates already in database.`);

    const csvPath = path.resolve(__dirname, '../../CandidateVerificationSystem/dataset/job_applicant_dataset.csv');
    if (!fs.existsSync(csvPath)) {
      console.error(`Dataset not found at: ${csvPath}`);
      return;
    }

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

    let processed = 0;
    let inserted = 0;
    let skipped = 0;

    const emailOccurrences = new Map<string, number>();

    const parser = fs.createReadStream(csvPath).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
      })
    );

    await client.query('BEGIN');

    for await (const rec of parser) {
      processed++;
      const fullName = (rec['Job Applicant Name'] || '').trim();
      if (!fullName) continue;

      const names = fullName.split(/\s+/);
      const firstName = names[0] || '';
      const lastName = names.slice(1).join(' ') || '';
      const baseHandle = `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

      const count = (emailOccurrences.get(baseHandle) || 0) + 1;
      emailOccurrences.set(baseHandle, count);

      const email = count === 1
        ? `${baseHandle}@applicant.example.com`
        : `${baseHandle}${count}@applicant.example.com`;

      if (existingEmails.has(email.toLowerCase())) {
        skipped++;
        continue;
      }

      const jobTitle = (rec['Job Roles'] || '').trim() || 'Applicant';
      const resumeText = (rec['Resume'] || '').trim();
      const ethnicity = (rec['Ethnicity'] || '').trim();
      const location = ethnicityToCountry[ethnicity] || ethnicity || 'Unknown';

      // Insert candidate
      const candRes = await client.query(
        `INSERT INTO candidates (
          first_name, last_name, full_name, email, current_job_title, location, status, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW(), NOW())
        RETURNING id;`,
        [firstName, lastName, fullName, email, jobTitle, location, adminUser.id]
      );
      const candidateId = candRes.rows[0].id;
      existingEmails.add(email.toLowerCase());

      // Insert document
      const docRes = await client.query(
        `INSERT INTO documents (
          candidate_id, file_name, file_type, file_size_bytes, storage_key, checksum_sha256, document_type, upload_status, uploaded_by, created_at
        ) VALUES ($1, $2, 'application/pdf', $3, $4, $5, 'resume', 'completed', $6, NOW())
        RETURNING id;`,
        [
          candidateId,
          `${firstName.toLowerCase()}_${lastName.toLowerCase()}_resume.pdf`,
          Buffer.byteLength(resumeText || 'resume'),
          `synthetic_${candidateId}.pdf`,
          `sha256_dataset_${candidateId.replace(/-/g, '')}`,
          adminUser.id,
        ]
      );
      const documentId = docRes.rows[0].id;

      // Insert resume extraction
      if (resumeText) {
        await client.query(
          `INSERT INTO resume_extractions (
            document_id, extracted_text, extracted_data, extraction_status, parser_name, parser_version, created_at
          ) VALUES ($1, $2, $3, 'completed', 'dataset-importer', '1.0.0', NOW());`,
          [documentId, resumeText, JSON.stringify({ summary: resumeText, experience: rec['Job Description'] || '', location })]
        );
      }

      inserted++;

      if (inserted % 100 === 0) {
        console.log(` - Inserted ${inserted} candidates...`);
      }

      if (maxToImport > 0 && inserted >= maxToImport) {
        console.log(`Reached requested import target of ${maxToImport} candidates.`);
        break;
      }
    }

    await client.query('COMMIT');

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n========================================`);
    console.log(`Import Complete in ${durationSec}s!`);
    console.log(` - Processed rows: ${processed}`);
    console.log(` - Newly inserted: ${inserted}`);
    console.log(` - Skipped dupes : ${skipped}`);
    console.log(` - Total in DB   : ${existingEmails.size}`);
    console.log(`========================================`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import failed with rollback:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

const targetCount = parseInt(process.argv[2] || '500', 10);
seedAll(targetCount);
