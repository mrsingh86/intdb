/**
 * Setup Gmail OAuth2 Authentication
 * This script helps you get the refresh token for Gmail API
 */

import readline from 'readline';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function setupGmailAuth() {
  console.log('\n🔐 Gmail OAuth2 Setup\n');
  console.log('This will help you get a refresh token for Gmail API access.\n');

  // Check if credentials file exists
  const credentialsPath = path.join(process.cwd(), 'gmail-credentials.json');

  if (!fs.existsSync(credentialsPath)) {
    console.log('⚠️  gmail-credentials.json not found!');
    console.log('\nPlease follow these steps:');
    console.log('1. Go to https://console.cloud.google.com/');
    console.log('2. Create a new project or select existing');
    console.log('3. Enable Gmail API');
    console.log('4. Create OAuth 2.0 credentials (Desktop application)');
    console.log('5. Download credentials and save as gmail-credentials.json\n');
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify'
    ]
  });

  console.log('📌 Authorize this app by visiting this URL:\n');
  console.log(authUrl);
  console.log('\n');

  // Get authorization code from user
  const code = await new Promise<string>((resolve) => {
    rl.question('Enter the authorization code from that page: ', (code) => {
      resolve(code);
    });
  });

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    console.log('\n✅ Success! Here are your credentials:\n');
    console.log('Add these to your .env file:\n');
    console.log(`GMAIL_CLIENT_ID=${client_id}`);
    console.log(`GMAIL_CLIENT_SECRET=${client_secret}`);
    console.log(`GMAIL_REDIRECT_URI=${redirect_uris[0]}`);
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);

    // Save to .env.local if it doesn't exist
    const envPath = path.join(process.cwd(), '.env.local');
    const envContent = `
# Gmail OAuth2 Credentials
GMAIL_CLIENT_ID=${client_id}
GMAIL_CLIENT_SECRET=${client_secret}
GMAIL_REDIRECT_URI=${redirect_uris[0]}
GMAIL_REFRESH_TOKEN=${tokens.refresh_token}
`;

    if (!fs.existsSync(envPath)) {
      fs.writeFileSync(envPath, envContent);
      console.log('\n📁 Credentials saved to .env.local');
    }

    // Test the connection
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    console.log('\n🔍 Testing Gmail connection...');
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log(`✅ Connected to Gmail: ${profile.data.emailAddress}`);
    console.log(`📊 Total messages: ${profile.data.messagesTotal}`);

  } catch (error: any) {
    console.error('\n❌ Error getting tokens:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run setup
setupGmailAuth().catch(console.error);