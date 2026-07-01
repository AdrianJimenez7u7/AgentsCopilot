import { prisma } from "../../../../shared/prisma/client.js";
import { SimpliaAgentsService } from "../../../../shared/services/simpliaAgents.service.js";
import { SapService } from "../sap.service.js";

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
        const required = ['usuario', 'idPaqueteria', 'unidadNegocio', 'serviceType', 'peso', 'ciudadOrigen', 'cpOrigen', 'ciudadDestino', 'cpDestino'];
        const missing = required.filter(f => !data[f]);
        if (missing.length) throw new Error(`Faltan campos requeridos: ${missing.join(', ')}`);

        return prisma.cotizaciones.create({
            data: {
                // ── Identificación ──────────────────────────────────────────
                usuario:               data.usuario,
                unidadNegocio:         data.unidadNegocio,
                idPaqueteria:          data.idPaqueteria,
                serviceType:           data.serviceType,
                status:                'PENDIENTE',
                fecha:                 data.fecha ? new Date(data.fecha) : new Date(),
                // ── Medidas ─────────────────────────────────────────────────
                peso:                  data.peso,
                dimensiones:           `width:${data.dimensiones?.width ?? 0}, height:${data.dimensiones?.height ?? 0}, length:${data.dimensiones?.length ?? 0}`,
                costoEstimado:         data.costoEstimado ?? null,
                // ── Origen ──────────────────────────────────────────────────
                ciudadOrigen:          data.ciudadOrigen,
                cpOrigen:              data.cpOrigen,
                empresaOrigen:         data.empresaOrigen         ?? null,
                calleOrigen:           data.calleOrigen           ?? null,
                coloniaOrigen:         data.coloniaOrigen         ?? null,
                numeroExteriorOrigen:  data.numeroExteriorOrigen  ?? null,
                referenciasOrigen:     data.referenciasOrigen     ?? null,
                telefonoOrigen:        data.telefonoOrigen        ?? null,
                // ── Destino ─────────────────────────────────────────────────
                ciudadDestino:         data.ciudadDestino,
                cpDestino:             data.cpDestino,
                empresaDestino:        data.empresaDestino        ?? null,
                calleDestino:          data.calleDestino          ?? null,
                coloniaDestino:        data.coloniaDestino         ?? null,
                numeroExteriorDestino: data.numeroExteriorDestino ?? null,
                referenciasDestino:    data.referenciasDestino    ?? null,
                telefonoDestino:       data.telefonoDestino       ?? null,
                correoReferencia:      data.correoReferencia      ?? null,
                contactoDestinatario:  data.contactoDestinatario  ?? null,
                estadoDestinatario:    data.estadoDestinatario    ?? null,
                // ── Detalle del envío ────────────────────────────────────────
                cantidadPaquetes:      data.cantidadPaquetes      ?? null,
                tipoPaquete:           data.tipoPaquete           ?? null,
                objetosTraslado:       data.objetosTraslado       ?? null,
                solicitudTraslado:     data.solicitudTraslado     ?? null,
                comentariosGenerales:  data.comentariosGenerales  ?? null,
                // ── DaaS ────────────────────────────────────────────────────
                isDaas:                data.isDaas                ?? false,
                nombreProyectoDaas:    data.nombreProyectoDaas    ?? null,
                // ── Gestión ─────────────────────────────────────────────────
                ejecutivoSugeridoEmail: data.ejecutivoSugeridoEmail ?? null,
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
                    empresaOrigen: cotizacion.empresaOrigen,
                    ciudadDestino: cotizacion.ciudadDestino,
                    cpDestino: cotizacion.cpDestino,
                    empresaDestino: cotizacion.empresaDestino,
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
            },
            include: {
                paqueteria: true
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
            include: {
                guias: true
            }
        });
        console.log(`Envíos encontrados para guías ${guiaArray.join(", ")}:`, envios);
        return { ok: true, error: null, code: 200, data: envios };
    }

    /**
     * Extrae la lista de números de guía desde un archivo CSV, XLSX o XLS.
     * Busca la columna "guia" / "guía" de forma insensible a tildes y mayúsculas.
     * @param {string} filePath
     * @returns {Promise<string[]>}
     */
    async _extraerGuiasDeExcel(filePath) {
        if (!filePath) throw new Error("El campo 'filePath' es requerido");

        const lowerPath = filePath.toLowerCase();
        if (!lowerPath.endsWith(".csv") && !lowerPath.endsWith(".xlsx") && !lowerPath.endsWith(".xls")) {
            throw new Error("El archivo debe ser de tipo CSV, XLSX o XLS");
        }

        const fs = await import("fs");
        if (!fs.existsSync(filePath)) throw new Error("El archivo no existe en la ruta especificada");

        const obtenerValorGuia = (row) => {
            const key = Object.keys(row).find(k =>
                k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") === "guia"
            );
            const valor = key ? row[key] : null;
            return valor && typeof valor === "string" ? valor.trim() : valor;
        };

        if (lowerPath.endsWith(".csv")) {
            const csvParser = await import("csv-parser");
            const guiasSet = new Set();
            return new Promise((resolve, reject) => {
                fs.createReadStream(filePath)
                    .pipe((csvParser.default || csvParser)())
                    .on("data", (row) => { const g = obtenerValorGuia(row); if (g) guiasSet.add(g); })
                    .on("end", () => resolve(Array.from(guiasSet)))
                    .on("error", () => reject(new Error("Error al leer el archivo CSV")));
            });
        }

        const xlsx = await import("xlsx");
        const workbook = xlsx.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet);
        return Array.from(new Set(data.map(obtenerValorGuia).filter(Boolean)));
    }

    async analizarExcelEnvios(filePath) {
        const guias = await this._extraerGuiasDeExcel(filePath);
        console.log(`Guías extraídas del archivo ${filePath}:`, guias);
        return this.getEnviosByGuiaArray(guias);
    }

    /**
     * Para cada guía del Excel busca en la BD (envíos + Simplia Agents) y en SAP en paralelo,
     * devolviendo un resultado unificado con la fuente de cada dato.
     * @param {string} filePath
     * @returns {Promise<Array>}
     */
    async relacionarGuiasExcelConColaboradores(filePath) {
        const guiasExcel = await this._extraerGuiasDeExcel(filePath);

        // BD y SAP en paralelo
        const [enviosBD, infoSAP] = await Promise.all([
            this.getEnviosByGuiaArray(guiasExcel),
            SapService.getTrackingInfoBatch(guiasExcel).catch((err) => {
                console.error("Error al consultar SAP en batch:", err.message);
                return [];
            })
        ]);

        // Índice guía → envío de BD
        const mapBD = new Map();
        for (const envio of enviosBD.data) {
            for (const guia of envio.guias) {
                mapBD.set(guia.numeroGuia, envio);
            }
        }

        // Índice guía → resultado SAP
        const mapSAP = new Map(infoSAP.map(r => [r.guia, r]));

        // Enriquecer con Simplia Agents (una sola petición por usuario único)
        const usuariosUnicos = [...new Set(
            guiasExcel.map(g => mapBD.get(g)?.usuario).filter(Boolean)
        )];
        const mapColaboradores = new Map();
        await Promise.all(
            usuariosUnicos.map(async (usuario) => {
                try {
                    const info = await SimpliaAgentsService.searchUser(usuario);
                    if (info) mapColaboradores.set(usuario, info.user);
                } catch {
                    // queda como no encontrado
                }
            })
        );

        // Resultado unificado por guía — si no está en BD, los datos vienen de SAP
        return guiasExcel.map((guia) => {
            const envio = mapBD.get(guia);
            const sap = mapSAP.get(guia);
            const colaborador = envio ? mapColaboradores.get(envio.usuario) : null;
            const sapEncontrada = sap?.success === true;

            if (envio) {
                // Encontrada en BD: datos completos de BD + Simplia Agents, SAP como complemento
                return {
                    numeroGuia: guia,
                    fuente: "BD",
                    encontradaEnBD: true,
                    encontradaEnSAP: sapEncontrada,
                    usuario: envio.usuario,
                    nombreColaborador: colaborador?.NombreCompleto ?? "Colaborador no encontrado",
                    areaColaborador: colaborador?.Area?.Nombre ?? "Área no encontrada",
                    puestoColaborador: colaborador?.Puesto ?? "Puesto no encontrado",
                    // Datos SAP como referencia adicional
                    tipoOperacionSAP: sap?.tipoOperacion ?? null,
                    clienteSAP: sap?.clienteOProveedor ?? null,
                    paqueteriaSAP: sap?.paqueteria ?? null,
                    solicitanteSAP: sap?.solicitante ?? null,
                    solicitanteEmailSAP: sap?.solicitanteEmail ?? null,
                    unidadNegocioSAP: sap?.unidadNegocio ?? null,
                    folioDocumentoSAP: sap?.folioDocumento ?? null,
                    estatusSAP: sap?.estatus ?? null,
                };
            }

            if (sapEncontrada) {
                // No está en BD pero sí en SAP: usar datos de SAP como fuente principal
                return {
                    numeroGuia: guia,
                    fuente: "SAP",
                    encontradaEnBD: false,
                    encontradaEnSAP: true,
                    usuario: null,
                    nombreColaborador: sap.solicitante ?? "Colaborador no encontrado en SAP",
                    areaColaborador: null,
                    puestoColaborador: null,
                    tipoOperacionSAP: sap.tipoOperacion ?? null,
                    clienteSAP: sap.clienteOProveedor ?? null,
                    paqueteriaSAP: sap.paqueteria ?? null,
                    solicitanteSAP: sap.solicitante ?? null,
                    solicitanteEmailSAP: sap.solicitanteEmail ?? null,
                    unidadNegocioSAP: sap.unidadNegocio ?? null,
                    folioDocumentoSAP: sap.folioDocumento ?? null,
                    estatusSAP: sap.estatus ?? null,
                };
            }

            // No encontrada en ninguna fuente
            return {
                numeroGuia: guia,
                fuente: null,
                encontradaEnBD: false,
                encontradaEnSAP: false,
                usuario: null,
                nombreColaborador: null,
                areaColaborador: null,
                puestoColaborador: null,
                tipoOperacionSAP: null,
                clienteSAP: null,
                paqueteriaSAP: null,
                solicitanteSAP: null,
                solicitanteEmailSAP: null,
                unidadNegocioSAP: null,
                folioDocumentoSAP: null,
                estatusSAP: null,
            };
        });
    }

}
