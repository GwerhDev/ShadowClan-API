import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

// Load .env from the project root (two levels up from src/config/)
dotenvConfig({ path: resolve(__dirname, '../../.env') });

interface Config {
  port:           number;
  environment:    string;
  apiUrl:         string;
  clientUrl:      string;
  appClientUrl:   string;
  dashboardUrl:   string;
  adminEmailList: string;
  mongodbString:  string;
  bnetClient:     string;
  bnetSecret:     string;
  cohereSecret:   string;
  privateSecret:  string;
  allowedOrigins: string;
  timezoneOffset: number;
}

const isProd = process.env.NODE_ENV === 'production';

function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export const config: Config = {
  port:           parseInt(env('PORT', '8080'), 10),
  environment:    env('NODE_ENV', 'development'),
  apiUrl:         isProd ? env('API_URL_PROD')        : env('API_URL'),
  clientUrl:      isProd ? env('CLIENT_URL_PROD')     : env('CLIENT_URL'),
  appClientUrl:   isProd ? env('APP_CLIENT_URL_PROD') : env('APP_CLIENT_URL'),
  dashboardUrl:   isProd ? env('DASHBOARD_URL_PROD')  : env('DASHBOARD_URL'),
  adminEmailList: env('ADMIN_EMAIL_LIST'),
  mongodbString:  env('MONGODB_STRING'),
  bnetClient:     env('BNET_CLIENT'),
  bnetSecret:     env('BNET_SECRET'),
  cohereSecret:   env('COHERE_SECRET'),
  privateSecret:  env('PRIVATE_SECRET'),
  allowedOrigins: isProd ? env('ALLOWED_ORIGINS_PROD') : env('ALLOWED_ORIGINS'),
  timezoneOffset: parseInt(env('TIMEZONE_OFFSET', '-3'), 10),
};

// Named exports for backward compat
export const {
  port, environment, apiUrl, clientUrl, appClientUrl, dashboardUrl,
  adminEmailList, mongodbString, bnetClient, bnetSecret, cohereSecret,
  privateSecret, allowedOrigins, timezoneOffset,
} = config;
