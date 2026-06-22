
export class UserMessage {
    history;
    message;
    threadId;
    user;
    file;
    constructor(
        history ,
        message,
        threadId,
        user,
        file = null
    ) {

        this.history = history;
        this.message = message;
        this.threadId = threadId;
        this.user = user;
        this.file = file;
    }
}
