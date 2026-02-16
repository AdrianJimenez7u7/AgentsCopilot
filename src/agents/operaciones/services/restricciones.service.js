
export class RestriccionesService {

    static SEARCH_USERS = [
        "miguel.jimenez@compucad.com.mx",
        "diego.valdez@compucad.com.mx",
        "abraham.pardo@compucad.com.mx",
        "juanc.gonzalez@compucad.com.mx",
        "gerardo.guzman@compucad.com.mx",
        "jessica.giron@compucad.com.mx",
        "transformacion.digital@compucad.com.mx"
    ]

    static TICKET_USERS = [
        "miguel.jimenez@compucad.com.mx",
        "diego.valdez@compucad.com.mx",
        "abraham.pardo@compucad.com.mx",
        "juanc.gonzalez@compucad.com.mx",
        "gerardo.guzman@compucad.com.mx",
        "jessica.giron@compucad.com.mx",
    ]

    static getPermissions(email) {
        const permissions = [];
        if (this.isSearchUser(email)) permissions.push('search');
        if (this.isTicketUser(email)) permissions.push('ticket');
        return permissions;
    }

    static isSearchUser(email) {
        return this.SEARCH_USERS.includes(email);
    }

    static isTicketUser(email) {
        return this.TICKET_USERS.includes(email);
    }
}
