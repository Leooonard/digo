/**
 * @fileOverview 执行命令
 * @author xuld <xuld@vip.qq.com>
 */
import * as childProcess from "child_process";
import { begin, end } from "./progress";
import { then } from "./then";
import { log, error } from "./logging";

/**
 * 异步执行一个命令行程序。
 * @param command 要执行的命令行。命令行参数以空格隔开。
 * @param options 执行相关参数。
 * @return 返回启动的子进程。
 */
export function exec(command: string, options?: childProcess.ExecOptions | childProcess.ExecOptionsWithStringEncoding | childProcess.ExecOptionsWithBufferEncoding | typeof callback, callback?: (exitCode: null | number, process?: childProcess.ChildProcess) => void) {
    if (typeof options === "function") {
        callback = options;
        options = undefined;
    }
    then(done => {
        const taskId = begin(command);
        const process = childProcess.exec(command, options, (e, stdout, stderr) => {
            end(taskId);
            if (stdout && stdout.length) {
                log(stdout.toString().trim());
            }
            if (stderr && stderr.length) {
                error(stderr.toString().trim());
            }
            if (e) {
                error(e);
            }
            callback && callback(e ? (<any>e).status : 0, process);
            done();
        });
    });
}

/**
 * 执行一个命令行程序。
 * @param command 要执行的命令行。命令行参数以空格隔开。
 * @param options 执行相关参数。
 * @return 返回子进程的退出码。
 */
export function execSync(command: string, options?: childProcess.ExecOptions | childProcess.ExecOptionsWithStringEncoding | childProcess.ExecOptionsWithBufferEncoding | typeof callback, callback?: (exitCode: null | number, result?: childProcess.SpawnSyncReturns<Buffer>) => void) {
    if (typeof options === "function") {
        callback = options;
        options = undefined;
    }
    options = options || {};
    (<childProcess.ExecOptions>options).shell = typeof (<childProcess.ExecOptions>options).shell === 'string' ? (<childProcess.ExecOptions>options).shell : <any>true;
    then(() => {
        const taskId = begin(command);
        try {
            const ret = childProcess.spawnSync(command, options);
            if (ret.stdout && ret.stdout.length) {
                log(ret.stdout.toString().trim());
            }
            if (ret.stderr && ret.stderr.length) {
                error(ret.stderr.toString().trim());
            }
            if (ret.error) {
                error(ret.error);
            } else if (ret.status !== 0) {
                error("Command {command} exit with code {code}.", {
                    command: (<any>ret).cmd || command,
                    code: ret.status
                });
            }
            callback && callback(ret.status, ret);
        } finally {
            end(taskId);
        }
    });
}
