import { prisma } from '../../../../shared/prisma/client.js';
import { randomUUID } from 'crypto';

export class AgentService {

    static async registrarAIUsesModels(agentName, userEmail, tokensInput, tokensOutput) {
        const agente = await prisma.Agentes.findFirst({
            where: { nombre_logico: agentName }
        });
        if (!agente) {
            return null;
        }

        const modelo = await prisma.Models.findUnique({
            where: { id: agente.idModelo }
        });
        if (!modelo) {
            return null;
        }
        const costoUso = ((modelo.inputTokenCostPerMillion / 1000000) * tokensInput) + ((modelo.outputTokenCostPerMillion / 1000000) * tokensOutput);

        console.log(`Costo calculado para uso de modelo ${modelo.nombre}: $${costoUso.toFixed(6)} USD (Input: ${tokensInput} tokens, Output: ${tokensOutput} tokens)`);
        return prisma.UsesModels.create({
            data: {
                idModel: agente.idModelo,
                colaboradorID: userEmail,
                project: 'hubinn',
                module: 'contadores',
                timeEjecucionSec: 0,
                averageTimeHumaneJecutationSec: 0,
                tokensInput:tokensInput,
                tokensOutput:tokensOutput,
                costAverage: costoUso,
                agentId: agente.id,
            }
        });
    }

    static async AgentActions(agentName, userEmail, actionType, descripcion, tokensInput, tokensOutput, Payload, errorMessage = null, runId = null) {
        const agente = await prisma.Agentes.findFirst({
            where: { nombre_logico: agentName }
        });
        if (!agente) {
            return null;
        }
        const modelo = await prisma.Models.findUnique({
            where: { id: agente.idModelo }
        });
        if (!modelo) {
            return null;
        }
        console.log(`Registrando acción del agente ${agente.nombre_logico} para el usuario ${userEmail} con tipo de acción ${actionType}. Tokens Input: ${tokensInput}, Tokens Output: ${tokensOutput}, Costo estimado: $${(((modelo.inputTokenCostPerMillion / 1000000) * tokensInput) + ((modelo.outputTokenCostPerMillion / 1000000) * tokensOutput)).toFixed(6)} USD`);
        return prisma.AgentActions.create({
            data: {
                agentId: agente.id,
                modelId: agente.idModelo,
                project: 'hubinn',
                module: 'contadores',
                actionType: actionType,
                description: descripcion,
                status: 'completed',
                runId: runId || randomUUID(),
                tokensInput: tokensInput,
                tokensOutput: tokensOutput,
                tokensTotal: tokensInput + tokensOutput,
                costAverage: ((modelo.inputTokenCostPerMillion / 1000000) * tokensInput) + ((modelo.outputTokenCostPerMillion / 1000000) * tokensOutput),
                payloadJson: Payload,
                errorMessage: errorMessage
            }
        });
    
    }

    static async saveMessageNoThread(agentName, userEmail, messageContent, role = 'user') {
        const agente = await prisma.Agentes.findFirst({
            where: { nombre_logico: agentName }
        });
        if (!agente) {
            return null;
        }
        const normalizedRole = role === 'agent' ? 'assistant' : role;
        const threadTitle = `${agentName}-no-thread`;
        let thread = await prisma.Thread.findFirst({
            where: {
                titulo: threadTitle,
                usuario: userEmail,
                plataforma: 'contadores'
            }
        });

        if (!thread) {
            thread = await prisma.Thread.create({
                data: {
                    titulo: threadTitle,
                    usuario: userEmail,
                    plataforma: 'contadores'
                }
            });
        }

        return prisma.Message.create({
            data: {
                threadId: thread.id,
                agente_id: agente.id,
                usuario: userEmail,
                role: normalizedRole,
                contenido: messageContent,
            }
        });
    }
}
