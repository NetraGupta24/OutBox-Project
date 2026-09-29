-- Runs once, when the MySQL volume is first created.
-- `prisma migrate dev` needs to create a temporary shadow database,
-- so the app user gets global privileges. Local development only.
GRANT ALL PRIVILEGES ON *.* TO 'reachinbox'@'%';
FLUSH PRIVILEGES;
