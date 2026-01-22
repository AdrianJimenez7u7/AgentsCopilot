import { LLMService } from "../services/LLM.js";

export class AriaController {
    static async analyzeDate(req, res) {
        try {
            const { date } = req.body;
            const result = await LLMService.analyzeDate(date);
            res.json({ result });
        } catch (error) {
            console.error('Error analyzing data:', error);
            res.status(500).json({ error: 'Error analyzing data' });
        }
    }
}