# Consultar los registros de contadores que tienen fecha límite de reporte anterior al inicio del mes del último escaneo registrado, sugiriendo una nueva fecha límite basada en el último escaneo y la fecha límite actual. Luego, actualizar la fecha límite de reporte en ContadoresInfoClientes para esos registros.
BEGIN TRAN;

;WITH UltimoEscaneo AS (
    SELECT
        c.Serie,
        MAX(c.FechaCaptura) AS UltimoEscaneo
    FROM Contadores c
    WHERE c.Serie IS NOT NULL
    GROUP BY c.Serie
),
Objetivo AS (
    SELECT
        cic.id,
        cic.Serie,
        cic.FechaLimiteReporte,
        ue.UltimoEscaneo,
        DATEADD(
            MONTH,
            DATEDIFF(
                MONTH,
                cic.FechaLimiteReporte,
                DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(ue.UltimoEscaneo), MONTH(ue.UltimoEscaneo), 1))
            ),
            cic.FechaLimiteReporte
        ) AS FechaLimiteNueva
    FROM ContadoresInfoClientes cic
    INNER JOIN UltimoEscaneo ue
        ON ue.Serie = cic.Serie
    WHERE cic.FechaLimiteReporte IS NOT NULL
      AND cic.FechaLimiteReporte < DATEFROMPARTS(YEAR(ue.UltimoEscaneo), MONTH(ue.UltimoEscaneo), 1)
)
UPDATE cic
SET cic.FechaLimiteReporte = o.FechaLimiteNueva
FROM ContadoresInfoClientes cic
INNER JOIN Objetivo o
    ON o.id = cic.id;

SELECT @@ROWCOUNT AS FilasActualizadas;

COMMIT TRAN;
/* Si algo no cuadra antes del commit:
ROLLBACK TRAN;
*/