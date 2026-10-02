-- Ensures the app role and database exist when Postgres first boots via
-- docker compose (POSTGRES_USER/POSTGRES_DB already do this; this file also
-- grants CREATEDB so `prisma migrate dev` can create shadow databases).
CREATE ROLE cinema WITH LOGIN PASSWORD 'cinema_dev_password' CREATEDB;
CREATE DATABASE cinema_studio OWNER cinema;
