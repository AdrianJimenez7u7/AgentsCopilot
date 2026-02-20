
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const API_KEY = '6tk_LgQwdsEF6vFAI-LDObPQmsqv29OB';

async function upload() {
    try {
        const form = new FormData();
        const filePath = path.join(__dirname, '../../test_products.csv');
        if (!fs.existsSync(filePath)) {
            console.error('File not found:', filePath);
            return;
        }
        form.append('file', fs.createReadStream(filePath));
        form.append('email', 'test@example.com');

        console.log('Uploading file:', filePath);

        const response = await axios.post('http://localhost:3000/agente/operaciones/search/file', form, {
            headers: {
                ...form.getHeaders(),
                'x-api-key': API_KEY
            }
        });

        console.log('Upload success:', JSON.stringify(response.data, null, 2));
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
