# E-commerce Service

A simple e-commerce backend service built with Node.js, Express, and PostgreSQL, containerized with Docker.

## Prerequisites

- Docker Desktop
- Node.js (for local development)

## Quick Start

1. Clone the repository
2. Run the application with Docker Compose:
   
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build 
   ```
3. The service will be available at `http://localhost:3000`

## Services

- ecom_service: Node.js application running on port 3000

- db: PostgreSQL database with:
  - Database: ecomDB
  - Username: user
  - Password: example
  - Port: 5432
  
## Database Management
- Connect to the database container:
  ```bash
    docker exec -it ecom-db-1 bash
   ```

- Access PostgreSQL CLI
  ```bash
  psql -U user -d ecomDB
  ```

- Common PostgreSQL commands:
  - `\l` - List all databases
  - `\dt` - List all tables in current database
  - `\c` database_name - Connect to a different database
  - `\q` - Exit PostgreSQL CLI

## Health Check
The service includes a health endpoint to verify both the application and database are running: `GET http://localhost:3000/health 

## Notes
- Database data is persisted in a Docker volume
- The service waits for the database to be healthy before starting
- The database automatically creates the specified database on first run