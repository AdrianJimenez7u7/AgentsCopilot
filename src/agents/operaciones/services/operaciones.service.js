
export class operacionesServicee {
    static async extractSKUfromDocument(document) {
        const file = document;
        const pathname = document.path;
        const filename = document.originalname;
        console.log("filename", filename);
        console.log("pathname", pathname);
        console.log("file", file);
        return "";
    }

}