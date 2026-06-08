import { prisma } from "../../../../shared/prisma/client.js";
import { SimpliaAgentsService } from "../../../../shared/services/simpliaAgents.service.js";

export class EnviosService {

    static async notificarUsuario(usuario, tipo, revisadoPor, notas, motivo) {

        const send = await fetch(`https://72b99d8814b3ee0b97825068e00c55.16.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/0f0dda75e8b94929a4e789f865be9bb3/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=9MeIT9MI9YpOk57ZZuMvMIt7OZM6SUuph16EC3-Axng`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ data: { usuario, tipo, revisadoPor, notas, motivo } })
        });
        return send.ok;
    }

    static async createCotizacion(data) {
        if (!data.usuario || !data.idPaqueteria || !data.peso || !data.ciudadOrigen || !data.cpOrigen || !data.ciudadDestino || !data.cpDestino || !data.costoEstimado) {
            throw new Error("Faltan campos requeridos para crear cotización");
        }
        console.log("Creando cotización con datos:", data);
        const userInfo = await SimpliaAgentsService.searchUser(data.usuario);
        console.log("Respuesta de Simplia Agents al buscar usuario:", userInfo);
        if (!userInfo || !userInfo.user.Correo) {
            throw new Error("Usuario no encontrado en Simplia Agents");
        }
        console.log("Información del usuario obtenida de Simplia Agents:", userInfo);
        return prisma.cotizaciones.create({
            data: {
                usuario: data.usuario,
                unidadNegocio: userInfo.user.Area.Nombre,
                idPaqueteria: data.idPaqueteria,
                peso: data.peso,
                ciudadOrigen: data.ciudadOrigen,
                cpOrigen: data.cpOrigen,
                ciudadDestino: data.ciudadDestino,
                cpDestino: data.cpDestino,
                costoEstimado: data.costoEstimado,
                serviceType: data.serviceType,
                dimensiones: "width:" + data.dimensiones.width + ", height:" + data.dimensiones.height + ", length:" + data.dimensiones.length,
                status: "PENDIENTE",
                fecha: data.fecha ? new Date(data.fecha) : new Date(),

            }
        });
    }

    static async getCotizacionesByStatus(status) {
        return prisma.cotizaciones.findMany({
            where: { status },
            orderBy: { fecha: 'desc' },
            include: {
                paqueteria: true
            }
        });
    }

    static async getAllCotizaciones() {
        return prisma.cotizaciones.findMany({
            orderBy: { fecha: 'desc' },
            include: {
                paqueteria: true
            },
            where: {
                deleted: false
            }
        });
    }

    static async autorizarCotizacion(id, userAutorizer) {

        const cotizacionId = Number.parseInt(id, 10);
        if (!Number.isInteger(cotizacionId) || !userAutorizer) {
            throw new Error("Faltan campos requeridos para autorizar cotización");
        }
        return prisma.$transaction(async (tx) => {
            const cotizacion = await tx.cotizaciones.findFirst({
                where: {
                    id: cotizacionId,
                    status: "PENDIENTE",
                    deleted: false
                }
            });

            if (!cotizacion) {
                throw new Error("Cotización no encontrada");
            }

            const envioExistente = await tx.envios.findFirst({
                where: {
                    idCotizacion: cotizacionId,
                    deleted: false
                }
            });

            if (envioExistente) {
                throw new Error("La cotización ya tiene un envío ligado");
            }

            const actualizarCotizacion = await tx.cotizaciones.update({
                where: { id: cotizacionId },
                data: {
                    status: "AUTORIZADA",
                    reviewedBy: userAutorizer,
                    reviewedAt: new Date()
                }
            });

            const nuevoEnvio = await tx.envios.create({
                data: {
                    idCotizacion: cotizacionId,
                    usuario: cotizacion.usuario,
                    unidadNegocio: cotizacion.unidadNegocio,
                    idPaqueteria: cotizacion.idPaqueteria,
                    dimensiones: cotizacion.dimensiones,
                    peso: cotizacion.peso,
                    ciudadOrigen: cotizacion.ciudadOrigen,
                    cpOrigen: cotizacion.cpOrigen,
                    ciudadDestino: cotizacion.ciudadDestino,
                    cpDestino: cotizacion.cpDestino,
                    estado: "CREADO",
                    serviceType: cotizacion.serviceType,
                    costoEnvio: 0,
                    impuestos: 0,
                    fechaEnvio: cotizacion.fecha,
                }
            });
            const notificacion = await EnviosService.notificarUsuario(cotizacion.usuario, "Cotización", userAutorizer, "Se Autorizo tu cotización de envio, con forme el responsable de seguimiento te lo estare comunicando", "Autorización de cotización y creación de envío");
            return {
                cotizacion: actualizarCotizacion,
                envio: nuevoEnvio
            };
        });
    }

    static async rechazarCotizacion(id, userAutorizer, motivoRechazo) {

        const cotizacionId = Number.parseInt(id, 10);
        if (!Number.isInteger(cotizacionId) || !userAutorizer || !motivoRechazo) {
            throw new Error("Faltan campos requeridos para rechazar cotización");
        }
        return prisma.cotizaciones.update({
            where: { id: cotizacionId },
            data: {
                status: "RECHAZADA",
                reviewedBy: userAutorizer,
                reviewedAt: new Date(),
                motivoRechazo: motivoRechazo
            }
        });
    }

    static async getPaqueterias() {
        return prisma.paqueterias.findMany({
            orderBy: { nombre: 'asc' }
        });
    }

    static async getAllEnvios() {
        return prisma.envios.findMany({
            orderBy: { fechaEnvio: 'desc' },
            where: {
                deleted: false
            },
            include: {
                cotizacion: {
                    include: {
                        paqueteria: true
                    }
                },
                guias: true
            }
        });
    }

    static async getAllCotizaciones() {
        return prisma.cotizaciones.findMany({
            orderBy: { fecha: 'desc' },
            where: {
                deleted: false
            },
            include: {
                paqueteria: true
            }
        });
    }

    static async vincularGuiaAEnvio(idEnvio, numeroGuia) {
        const envioId = Number.parseInt(idEnvio, 10);
        console.log("Vinculando guía a envío:", { envioId, numeroGuia });
        if (!Number.isInteger(envioId) || !numeroGuia) {
            throw new Error("Faltan campos requeridos para vincular guía a envío");
        }
        const guidaExistente = await prisma.GuiasEnvio.findFirst({
            where: {
                numeroGuia: numeroGuia,
                deleted: false
            }
        });
        if (guidaExistente) {
            throw new Error("El número de guía ya está vinculado a otro envío");
        }
        return prisma.GuiasEnvio.create({
            data: {
                idEnvio: envioId,
                numeroGuia: numeroGuia,
                estadoGuia: "VINCULADA",
                fechaEnvio: new Date()
            }
        });
    }

    static async updateEnvio(idEnvio, data) {
        const envioId = Number.parseInt(idEnvio, 10);
        console.log("payload", { envioId, data });
        if (!Number.isInteger(envioId)) {
            throw new Error("ID de envío inválido");
        }

        const envioExistente = await prisma.envios.findFirst({
            where: {
                id: envioId,
                deleted: false
            }
        });

        const updatedEnvio = await prisma.envios.update({
            where: { id: envioId },
            data: {
                estado: data.estado || envioExistente.estado,
                costoEnvio: data.costoEnvio !== undefined ? data.costoEnvio : envioExistente.costoEnvio,
                impuestos: data.impuestos !== undefined ? data.impuestos : envioExistente.impuestos,
                fechaEnvio: data.fechaEnvio ? new Date(data.fechaEnvio) : envioExistente.fechaEnvio,
                costoEnvio: data.costoEnvio !== undefined ? data.costoEnvio : envioExistente.costoEnvio,
                peso: data.peso !== undefined ? data.peso : envioExistente.peso,
                dimensiones: data.dimensiones ? `width:${data.dimensiones.width}, height:${data.dimensiones.height}, length:${data.dimensiones.length}` : envioExistente.dimensiones,
                typeService: data.typeService || envioExistente.typeService,
                comentarios: data.comentarios || envioExistente.comentarios
            }
        });

        const guiasEnvio = data.guias;

        for (const guia of guiasEnvio) {
            const guiaVinculada = await prisma.GuiasEnvio.findFirst({
                where: {
                    numeroGuia: guia.numeroGuia,
                    deleted: false
                }
            });
            if (!guiaVinculada) {
                await prisma.GuiasEnvio.create({
                    data: {
                        idEnvio: envioId,
                        numeroGuia: guia.numeroGuia,
                        estadoGuia: guia.estadoGuia || "VINCULADA",
                        fechaEnvio: new Date()
                    }
                });
            } else if (guiaVinculada.idEnvio !== envioId) {
                throw new Error(`El número de guía ${guia.numeroGuia} ya está vinculado a otro envío`);
            }
        }

        const nuevoEnvio = await prisma.envios.findFirst({
            where: {
                id: envioId,
                deleted: false
            },
            include: {
                cotizacion: {
                    include: {
                        paqueteria: true
                    }
                },
                guias: true
            }
        });
        return nuevoEnvio;
    }

    /**
     * en base al usuario, obtener el estatus de sus envíos y cotizaciones en los últimos 30 días
     * @param {string} usuario 
     * @returns 
     */
    async getEstatusEnviosUsuario(usuario) {
        if (!usuario) {
            throw new Error("El campo 'usuario' es requerido");
        }
        console.log(`Obteniendo estatus de envíos y cotizaciones para usuario: ${usuario}`);
        const cotizacionesUsuario = await prisma.cotizaciones.findMany({
            where: {
                usuario,
                deleted: false,
                fecha: {
                    gte: new Date(new Date().setDate(new Date().getDate() - 30)) // Últimos 30 días
                }
            },
            orderBy: { fecha: 'desc' },
        });

        const envios = await prisma.envios.findMany({
            where: {
                usuario,
                deleted: false,
                fechaEnvio: {
                    gte: new Date(new Date().setDate(new Date().getDate() - 30)) // Últimos 30 días
                }
            },
            orderBy: { fechaEnvio: 'desc' },
            include: {
                cotizacion: {
                    include: {
                        paqueteria: true
                    }
                },
                guias: true
            }
        });
        console.log(`Estatus de envíos y cotizaciones para usuario ${usuario}:`, { envios, cotizacionesUsuario });
        return { ok: true, error: null, code: 200, data: { envios: envios, cotizaciones: cotizacionesUsuario } };
    }

    async getEnviosByGuiaArray(guiaArray) {
        if (!Array.isArray(guiaArray) || guiaArray.length === 0) {
            throw new Error("El campo 'guiaArray' debe ser un array no vacío");
        }
        console.log(`Obteniendo envíos para guías: ${guiaArray.join(", ")}`);
        const envios = await prisma.envios.findMany({
            where: {
                deleted: false,
                guias: {
                    some: {
                        numeroGuia: {
                            in: guiaArray
                        }
                    }
                }
            },
            orderBy: { fechaEnvio: 'desc' },
        }
        );
        console.log(`Envíos encontrados para guías ${guiaArray.join(", ")}:`, envios);
        return { ok: true, error: null, code: 200, data: envios };
    }


    async analizarExcelEnvios(filePath) {
        if (!filePath) {
            throw new Error("El campo 'filePath' es requerido");
        }
        console.log(`Analizando archivo de envíos: ${filePath}`);

        // 1. Validar extensión de forma insensible a mayúsculas (.XLSX también pasa)
        const lowerPath = filePath.toLowerCase();
        if (!lowerPath.endsWith(".csv") && !lowerPath.endsWith(".xlsx") && !lowerPath.endsWith(".xls")) {
            throw new Error("El archivo debe ser de tipo CSV, XLSX o XLS");
        }

        // 2. Validar existencia del archivo una sola vez
        const fs = await import("fs");
        if (!fs.existsSync(filePath)) {
            throw new Error("El archivo no existe en la ruta especificada");
        }

        // Función auxiliar para buscar la propiedad "guia" de forma tolerante
        const obtenerValorGuia = (row) => {
            // Busca cualquier llave que se llame 'guia', 'guía', 'GUIA', etc.
            const key = Object.keys(row).find(k => k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "guia");
            const valor = key ? row[key] : null;
            return valor && typeof valor === 'string' ? valor.trim() : valor;
        };

        // 3. Procesar según el tipo de archivo
        if (lowerPath.endsWith(".csv")) {
            const csvParser = await import("csv-parser");
            const guiasSet = new Set(); // Evita duplicados desde la extracción

            return new Promise((resolve, reject) => {
                fs.createReadStream(filePath)
                    // Se adapta a configuraciones ESM/CommonJS usando el parser directamente si default no existe
                    .pipe((csvParser.default || csvParser)())
                    .on("data", (row) => {
                        const guia = obtenerValorGuia(row);
                        if (guia) guiasSet.add(guia);
                    })
                    .on("end", () => {
                        const guias = Array.from(guiasSet);
                        console.log(`Guías extraídas del CSV ${filePath}:`, guias);
                        resolve(this.getEnviosByGuiaArray(guias));
                    })
                    .on("error", (error) => {
                        console.error(`Error al leer el archivo ${filePath}:`, error);
                        reject(new Error("Error al leer el archivo CSV"));
                    });
            });
        }

        if (lowerPath.endsWith(".xlsx") || lowerPath.endsWith(".xls")) {
            const xlsx = await import("xlsx");

            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(sheet);

            // Mapea buscando la columna de forma segura
            const guiasRaw = data.map(row => obtenerValorGuia(row)); // <-- Corregido aquí
            const guias = Array.from(new Set(guiasRaw.filter(Boolean)));

            console.log(`Guías extraídas del Excel ${filePath}:`, guias);
            return this.getEnviosByGuiaArray(guias);
        }
    }

    async relacionarGuiasExcelConColaboradores(filePath) {
        const guiasEnvio = await this.analizarExcelEnvios(filePath);
        const resultados = [];

        for (const envio of guiasEnvio.data) {
            const colaborador = await SimpliaAgentsService.searchUser(envio.usuario);
            resultados.push({
                numeroGuia: envio.guias.map(g => g.numeroGuia).join(", "),
                usuario: envio.usuario,
                nombreColaborador: colaborador ? colaborador.user.NombreCompleto : "Colaborador no encontrado",
                areaColaborador: colaborador ? colaborador.user.Area.Nombre : "Área no encontrada",
                puestoColaborador: colaborador ? colaborador.user.Puesto : "Puesto no encontrado"
            });
        }
        return resultados;
    } 

}