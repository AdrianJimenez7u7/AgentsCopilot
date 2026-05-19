
export class UserMessage {
    history;
    message;
    threadId;
    user;
    constructor(
        history ,
        message,
        threadId,
        user
    ) {
        
        this.history = history;
        this.message = message;
        this.threadId = threadId;
        this.user = user;
    }
}
