
require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const API_KEY = process.env.OPERACIONES_COPILOT_X_API_KEY || process.env.API_KEY;
const BASE_URL = process.env.OPERACIONES_BACKEND_BASE_URL || 'http://localhost:3000';

async function upload() {
    try {
        if (!API_KEY) {
            throw new Error('Falta OPERACIONES_COPILOT_X_API_KEY o API_KEY en variables de entorno');
        }

        const form = new FormData();
        const filePath = path.join(__dirname, '../../test_products.csv');
        if (!fs.existsSync(filePath)) {
            console.error('File not found:', filePath);
            return;
        }
        form.append('file', fs.createReadStream(filePath));
        form.append('email', 'test@example.com');

        const response = await axios.post(`${BASE_URL.replace(/\/+$/, '')}/agente/operaciones/search/file`, form, {
            headers: {
                ...form.getHeaders(),
                'x-api-key': API_KEY
            }
        });
    } catch (error) {
        if (error.response) {
            console.error('Upload failed with status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Upload failed:', error.message);
        }
    }
}

upload();
