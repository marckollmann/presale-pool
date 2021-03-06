const chai = require('chai');

const server = require('./server');
const util = require('./util');

const expect = chai.expect;

describe('pay to presale address', () => {
    let defaultPoolArgs = [0, 0, 0, []];
    let creator;
    let buyer1;
    let buyer2;
    let payoutAddress;
    let web3;
    let PBFeeManager;
    let poolFee = 0.005;
    let PresalePoolLib;

    before(async () => {
        let result = await server.setUp();
        web3 = result.web3;
        creator = result.addresses[0].toLowerCase();
        buyer1 = result.addresses[1].toLowerCase();
        buyer2 = result.addresses[2].toLowerCase();
        payoutAddress = result.addresses[3].toLowerCase();
        let feeTeamMember = result.addresses[result.addresses.length-1].toLowerCase();
        PBFeeManager = await util.deployContract(
            web3,
            "PBFeeManager",
            creator,
            [
                [feeTeamMember],
                util.toWei(web3, 0.005, "ether"),
                util.toWei(web3, 0.01, "ether")
            ]
        );
        PresalePoolLib = await util.deployContract(
            web3,
            "PoolLib",
            creator,
            []
        );
    });


    after(async () => {
        await server.tearDown();
    });

    let PresalePool;
    beforeEach(async () => {
        PresalePool = await util.deployContract(
            web3,
            "PresalePool",
            creator,
            util.createPoolArgs({
                feeManager: PBFeeManager.options.address,
                maxContribution: util.toWei(web3, 50, "ether"),
                maxPoolBalance: util.toWei(web3, 50, "ether")
            }),
            0,
            { 'PoolLib.sol:PoolLib': PresalePoolLib.options.address }
        );
    });

    async function payToPresale(expectedPayout, minPoolTotal) {
        let beforeBalance = await web3.eth.getBalance(payoutAddress);

        await util.methodWithGas(
            PresalePool.methods.payToPresale(
                payoutAddress,
                minPoolTotal || expectedPayout,
                0, "0x"
            ),
            creator
        );

        let afterBalance = await web3.eth.getBalance(payoutAddress);
        let difference = parseInt(afterBalance) - parseInt(beforeBalance);
        expect(difference / expectedPayout).to.be.within(.98, 1.0);
    }

    it("cant be called if the pool balance is 0", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer2,
            util.toWei(web3, 1, "ether")
        );
        await util.methodWithGas(
            PresalePool.methods.setContributionSettings(
                util.toWei(web3, 2, "ether"), util.toWei(web3, 3, "ether"), util.toWei(web3, 3, "ether"), []
            ),
            creator
        );
        await util.expectVMException(
            util.methodWithGas(PresalePool.methods.payToPresale(payoutAddress, 0, 0, "0x"), creator)
        );
    });

    it("cant be called from failed state", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.methodWithGas(PresalePool.methods.fail(), creator)

        await util.expectVMException(
            util.methodWithGas(PresalePool.methods.payToPresale(payoutAddress, 0, 0, "0x"), creator)
        );
    });

    it("can only be called by creator", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.expectVMException(
            util.methodWithGas(PresalePool.methods.payToPresale(payoutAddress, 0, 0, "0x"), buyer1)
        );
    });

    it("fails if the receiving address does not accept the payment", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.expectVMException(
            util.methodWithGas(
                PresalePool.methods.payToPresale(PresalePool.options.address, 0, 0, "0x"),
                creator
            )
        );
    });

    it("fails if the receiving address uses all the gas", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        let GasHungry = await util.deployContract(
            web3,
            "GasHungry",
            creator,
            []
        );
        await util.expectVMException(
            util.methodWithGas(
                PresalePool.methods.payToPresale(GasHungry.options.address, 0, 0, "0x"),
                creator
            )
        );
    });

    it("cant be called more than once", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.methodWithGas(PresalePool.methods.payToPresale(payoutAddress, 0, 0, "0x"), creator);

        await util.expectVMException(
            util.methodWithGas(PresalePool.methods.payToPresale(payoutAddress, 0, 0, "0x"), creator)
        );
    });

    it("cant transition to failed state from paid state", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.methodWithGas(PresalePool.methods.payToPresale(payoutAddress, 0, 0, "0x"), creator);

        await util.expectVMException(
            util.methodWithGas(PresalePool.methods.fail(), creator)
        );
    });

    it("does not accept deposits after a payout", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.methodWithGas(PresalePool.methods.payToPresale(payoutAddress, 0, 0, "0x"), creator);
        await util.expectVMException(
            util.methodWithGas(
                PresalePool.methods.deposit(),
                buyer1,
                util.toWei(web3, 5, "ether")
            )
        );
    });

    it("respects min contribution", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer2,
            util.toWei(web3, 1, "ether")
        );

        await util.methodWithGas(
            PresalePool.methods.setContributionSettings(
                util.toWei(web3, 2, "ether"),
                util.toWei(web3, 50, "ether"),
                util.toWei(web3, 50, "ether"),
                []
            ),
            creator
        );

        let expectedBalances = {};
        expectedBalances[buyer1] = {
            remaining: util.toWei(web3, 0, "ether"),
            contribution: util.toWei(web3, 5, "ether")
        };
        expectedBalances[buyer2] = {
            remaining: util.toWei(web3, 1, "ether"),
            contribution: util.toWei(web3, 0, "ether")
        };
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 6, "ether"));
        await payToPresale(util.toWei(web3, 5, "ether"), 0);
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 1 + 5*poolFee, "ether"));

        let buyerBalance = await web3.eth.getBalance(buyer2);
        await util.methodWithGas(PresalePool.methods.withdrawAll(), buyer2);
        expectedBalances[buyer2].remaining = util.toWei(web3, 0, "ether");
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 5*poolFee, "ether"));

        let balanceAfterWithdrawl = await web3.eth.getBalance(buyer2);
        let difference = parseInt(balanceAfterWithdrawl) - parseInt(buyerBalance);
        expect(difference / util.toWei(web3, 1, "ether")).to.be.within(.98, 1.0);
    });

    it("respects max contribution", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer2,
            util.toWei(web3, 1, "ether")
        );

        await util.methodWithGas(
            PresalePool.methods.setContributionSettings(
                0,
                util.toWei(web3, 2, "ether"),
                util.toWei(web3, 50, "ether"),
                []
            ),
            creator
        );

        let expectedBalances = {};
        expectedBalances[buyer1] = {
            remaining: util.toWei(web3, 3, "ether"),
            contribution: util.toWei(web3, 2, "ether")
        };
        expectedBalances[buyer2] = {
            remaining: util.toWei(web3, 0, "ether"),
            contribution: util.toWei(web3, 1, "ether")
        };
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 6, "ether"));
        await payToPresale(util.toWei(web3, 3, "ether"), 0);
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 3 + 3*poolFee, "ether"));

        let buyerBalance = await web3.eth.getBalance(buyer1);
        await util.methodWithGas(
            PresalePool.methods.withdrawAllForMany([buyer1]),
            buyer2
        );
        expectedBalances[buyer1].remaining = util.toWei(web3, 0, "ether");
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 3*poolFee, "ether"));

        let balanceAfterWithdrawl = await web3.eth.getBalance(buyer1);
        let difference = parseInt(balanceAfterWithdrawl) - parseInt(buyerBalance);
        expect(difference / util.toWei(web3, 3, "ether")).to.be.within(.98, 1.0);
    });

    it("respects pool max", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer2,
            util.toWei(web3, 1, "ether")
        );

        await util.methodWithGas(
            PresalePool.methods.setContributionSettings(
                0,
                util.toWei(web3, 2, "ether"),
                util.toWei(web3, 2, "ether"),
                []
            ),
            creator
        );

        let expectedBalances = {};
        expectedBalances[buyer1] = {
            remaining: util.toWei(web3, 3, "ether"),
            contribution: util.toWei(web3, 2, "ether")
        };
        expectedBalances[buyer2] = {
            remaining: util.toWei(web3, 1, "ether"),
            contribution: util.toWei(web3, 0, "ether")
        };
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 6, "ether"));
        await payToPresale(util.toWei(web3, 2, "ether"), 0);
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 4 + 2*poolFee, "ether"));

        let buyerBalance = await web3.eth.getBalance(buyer1);
        //cant do partial withdrawls in paid state
        await util.expectVMException(
            util.methodWithGas(
                PresalePool.methods.withdraw(util.toWei(web3, 5, "ether")),
                buyer1
            )
        );
        await util.methodWithGas(
            PresalePool.methods.withdrawAll(),
            buyer1
        );
        expectedBalances[buyer1].remaining = util.toWei(web3, 0, "ether");
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 1 + 2*poolFee, "ether"));

        let balanceAfterWithdrawl = await web3.eth.getBalance(buyer1);
        let difference = parseInt(balanceAfterWithdrawl) - parseInt(buyerBalance);
        expect(difference / util.toWei(web3, 3, "ether")).to.be.within(.97, 1.0);
    });

    it("respects contribution settings", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            creator,
            util.toWei(web3, 2, "ether")
        );
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer2,
            util.toWei(web3, 1, "ether")
        );

        await util.methodWithGas(
            PresalePool.methods.setContributionSettings(
                0,
                util.toWei(web3, 2, "ether"),
                util.toWei(web3, 3, "ether"),
                []
            ),
            creator
        );

        let expectedBalances = {};
        expectedBalances[creator] = {
            remaining: util.toWei(web3, 0, "ether"),
            contribution: util.toWei(web3, 2, "ether")
        };
        expectedBalances[buyer1] = {
            remaining: util.toWei(web3, 4, "ether"),
            contribution: util.toWei(web3, 1, "ether")
        };
        expectedBalances[buyer2] = {
            remaining: util.toWei(web3, 1, "ether"),
            contribution: util.toWei(web3, 0, "ether")
        };
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 8, "ether"));
        await payToPresale(util.toWei(web3, 3, "ether"), 0);
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 5 + 3*poolFee, "ether"));

        let buyerBalance = await web3.eth.getBalance(buyer1);
        await util.methodWithGas(PresalePool.methods.withdrawAll(), buyer1);
        expectedBalances[buyer1].remaining = util.toWei(web3, 0, "ether");
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 1 + 3*poolFee, "ether"));

        let balanceAfterWithdrawl = await web3.eth.getBalance(buyer1);
        let difference = parseInt(balanceAfterWithdrawl) - parseInt(buyerBalance);
        expect(difference / util.toWei(web3, 4, "ether")).to.be.within(.98, 1.0);
    });

    it("respects whitelist", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer2,
            util.toWei(web3, 1, "ether")
        );

        await util.methodWithGas(PresalePool.methods.modifyWhitelist([], [buyer2]), creator);

        let expectedBalances = {};
        expectedBalances[buyer1] = {
            remaining: util.toWei(web3, 0, "ether"),
            contribution: util.toWei(web3, 5, "ether")
        };
        expectedBalances[buyer2] = {
            remaining: util.toWei(web3, 1, "ether"),
            contribution: util.toWei(web3, 0, "ether")
        };
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 6, "ether"));
        await payToPresale(util.toWei(web3, 5, "ether"), 0);
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 1 + 5*poolFee, "ether"));

        let buyerBalance = await web3.eth.getBalance(buyer2);
        await util.methodWithGas(PresalePool.methods.withdrawAll(), buyer2);
        expectedBalances[buyer2].remaining = util.toWei(web3, 0, "ether");
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 5*poolFee, "ether"));

        let balanceAfterWithdrawl = await web3.eth.getBalance(buyer2);
        let difference = parseInt(balanceAfterWithdrawl) - parseInt(buyerBalance);
        expect(difference / util.toWei(web3, 1, "ether")).to.be.within(.98, 1.0);
    });

    it("fails if pool balance is less than minPoolTotal", async () => {
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer1,
            util.toWei(web3, 5, "ether")
        );
        await util.methodWithGas(
            PresalePool.methods.deposit(),
            buyer2,
            util.toWei(web3, 1, "ether")
        );

        let expectedBalances = {};
        expectedBalances[buyer1] = {
            remaining: util.toWei(web3, 0, "ether"),
            contribution: util.toWei(web3, 5, "ether")
        };
        expectedBalances[buyer2] = {
            remaining: util.toWei(web3, 0, "ether"),
            contribution: util.toWei(web3, 1, "ether")
        };
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 6, "ether"));
        await util.expectVMException(
            util.methodWithGas(
                PresalePool.methods.payToPresale(
                    payoutAddress,
                    util.toWei(web3, 7, "ether"),
                    0, "0x"
                ),
                creator
            )
        );

        await util.methodWithGas(
            PresalePool.methods.setContributionSettings(
                0,
                util.toWei(web3, 2, "ether"),
                util.toWei(web3, 50, "ether"),
                []
            ),
            creator
        );
        expectedBalances[buyer1] = {
            remaining: util.toWei(web3, 3, "ether"),
            contribution: util.toWei(web3, 2, "ether")
        };
        await util.verifyState(web3, PresalePool, expectedBalances, util.toWei(web3, 6, "ether"));
        await util.expectVMException(
            util.methodWithGas(
                PresalePool.methods.payToPresale(
                    payoutAddress,
                    util.toWei(web3, 6, "ether"),
                    0, "0x"
                ),
                creator
            )
        );

        await payToPresale(util.toWei(web3, 3, "ether"), util.toWei(web3, 3, "ether"));
    });
});

