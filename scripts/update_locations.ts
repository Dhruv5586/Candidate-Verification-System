import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { pool } from '../node-api/src/config/database';

async function updateLocations() {
  const csvPath = path.resolve(__dirname, '../CandidateVerificationSystem/dataset/job_applicant_dataset.csv');
  const records = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true });

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

  const client = await pool.connect();
  let updated = 0;
  try {
    for (const r of records) {
      const name = (r['Job Applicant Name'] || '').trim();
      const ethnicity = (r['Ethnicity'] || '').trim();
      const country = ethnicityToCountry[ethnicity] || ethnicity;

      const res = await client.query(
        'UPDATE candidates SET location = $1 WHERE full_name = $2 RETURNING id;',
        [country, name]
      );
      if (res.rowCount && res.rowCount > 0) {
        updated += res.rowCount;
      }
    }
    console.log(`Updated location for ${updated} candidates.`);

    const ukRes = await client.query(
      `SELECT id, full_name, email, current_job_title, location FROM candidates WHERE location = 'United Kingdom' OR location ILIKE '%UK%' ORDER BY full_name;`
    );
    console.log('\n--- CANDIDATES FROM UK (United Kingdom) ---');
    console.table(ukRes.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

updateLocations();
